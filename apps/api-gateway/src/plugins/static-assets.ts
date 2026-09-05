/**
 * Static Assets Plugin (Task 55.6 / Requirement 39)
 *
 * Serves the Vite-built SPA artifacts (`apps/web/dist`) and prefers
 * pre-compressed siblings (`.br` then `.gz`) when the client advertises
 * the encoding via `Accept-Encoding`. Falls back to the uncompressed
 * file when no acceptable encoding is offered or when the encoded
 * sibling is missing.
 *
 * The plugin guarantees that every response includes:
 * - `Vary: Accept-Encoding` so caches and CDNs do not collapse the
 *   encoded and identity payloads into a single cache entry
 * - The original asset's `Content-Type` (e.g. `application/javascript`)
 *   even when the served file is `.br` / `.gz` — the encoding is
 *   communicated through `Content-Encoding`, not the MIME type
 * - `Content-Encoding: br` or `Content-Encoding: gzip` when a
 *   pre-compressed sibling is served
 *
 * If a CDN sits in front of the gateway, the `Vary` header lets the
 * CDN cache both variants without leaking gzip-encoded payloads to
 * clients that did not request gzip.
 *
 * The plugin is intentionally registered WITHOUT `fastify-plugin`'s
 * `fp()` wrapper so its hooks are encapsulated to the static-assets
 * scope. Other gateway routes (`/api/*`, `/health`, `/docs`, ...) are
 * untouched.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Options for the static-assets plugin.
 */
export interface StaticAssetsOptions {
  /**
   * Absolute path to the directory served by the plugin (typically the
   * Vite `dist/` output). When omitted or pointing at a directory that
   * does not exist the plugin is a no-op so the gateway can run
   * without a local SPA build (e.g. when fronted by a CDN that owns
   * delivery).
   */
  root?: string;
  /**
   * URL prefix under which the static assets are exposed. Defaults to
   * `/static/` so the SPA shell does not interfere with `/api/*`,
   * `/health`, `/docs`, and other gateway routes.
   */
  prefix?: string;
  /**
   * SPA fallback: when true, requests under the prefix that don't
   * match a file are answered with `index.html` so the React Router
   * can take over. Defaults to true when an `index.html` exists in
   * the configured root.
   */
  spaFallback?: boolean;
}

/**
 * Encodings the gateway advertises support for, ordered by preference.
 * Brotli is preferred over gzip because it produces smaller payloads
 * on text content. Exported for tests.
 */
export const SUPPORTED_ENCODINGS = ['br', 'gzip'] as const;

export type SupportedEncoding = (typeof SUPPORTED_ENCODINGS)[number];

/**
 * Parses an `Accept-Encoding` header into the set of encodings the
 * client is willing to accept. Encodings listed with `q=0` are
 * excluded; an explicit `*` enables every supported encoding unless
 * an entry like `gzip;q=0` explicitly disables it.
 *
 * Example inputs:
 *   "br, gzip"                → {"br","gzip"}
 *   "gzip;q=0.5, br;q=1"      → {"br","gzip"}
 *   "gzip;q=0"                → {} (gzip explicitly disabled)
 *   "*"                       → {"br","gzip"} (every supported encoding)
 *   "*, gzip;q=0"             → {"br"} (wildcard minus gzip)
 *   undefined                 → {}
 */
export function parseAcceptEncoding(header: string | undefined): Set<SupportedEncoding> {
  const accepted = new Set<SupportedEncoding>();
  if (!header) return accepted;

  let wildcardEnabled = false;
  const explicitlyDisabled = new Set<string>();

  for (const part of header.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const segments = trimmed.split(';').map((s) => s.trim());
    const name = segments[0]!.toLowerCase();

    let q = 1;
    for (const segment of segments.slice(1)) {
      const match = /^q\s*=\s*([0-9.]+)$/i.exec(segment);
      if (match) {
        const parsed = Number.parseFloat(match[1]!);
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }

    if (q <= 0) {
      explicitlyDisabled.add(name);
      continue;
    }

    if (name === '*') {
      wildcardEnabled = true;
    } else if ((SUPPORTED_ENCODINGS as readonly string[]).includes(name)) {
      accepted.add(name as SupportedEncoding);
    }
  }

  if (wildcardEnabled) {
    for (const encoding of SUPPORTED_ENCODINGS) {
      if (!explicitlyDisabled.has(encoding)) {
        accepted.add(encoding);
      }
    }
  }

  // Honour explicit disables even when the encoding was also enabled
  // (e.g. "gzip, gzip;q=0" — the q=0 wins per RFC 9110).
  for (const disabled of explicitlyDisabled) {
    accepted.delete(disabled as SupportedEncoding);
  }

  return accepted;
}

/**
 * Builds the `Accept-Encoding` header value the gateway forwards to
 * `@fastify/static`. We rewrite the incoming header so that the only
 * encodings the underlying plugin sees are ones we actually want it
 * to consider; this keeps the brotli-first / gzip-second ordering
 * consistent regardless of the client's stated preference.
 *
 * Returns an empty string when the client does not accept any
 * supported encoding, which signals the caller to drop the header
 * entirely so identity is served.
 */
export function buildForwardedAcceptEncoding(
  accepted: Set<SupportedEncoding>,
): string {
  const parts: string[] = [];
  for (const encoding of SUPPORTED_ENCODINGS) {
    if (accepted.has(encoding)) parts.push(encoding);
  }
  return parts.join(', ');
}

const staticAssetsPlugin: FastifyPluginAsync<StaticAssetsOptions> = async (
  fastify,
  options,
) => {
  const { root } = options;

  // NOTE: the `prefix` option is consumed by Fastify itself when this
  // plugin is registered (it scopes the plugin's encapsulated routes
  // under that URL prefix). We deliberately do NOT forward it to
  // `@fastify/static` because that would double-apply the prefix and
  // mount the assets at e.g. `/static/static/*`. The encapsulated
  // scope already takes care of the URL prefix.

  if (!root) {
    fastify.log.info(
      'static-assets plugin: no `root` configured, skipping registration',
    );
    return;
  }

  const rootResolved = resolve(root);
  if (!existsSync(rootResolved)) {
    fastify.log.warn(
      { root: rootResolved },
      'static-assets plugin: configured root does not exist; skipping',
    );
    return;
  }

  const indexPath = resolve(rootResolved, 'index.html');
  const spaFallback =
    options.spaFallback === undefined
      ? existsSync(indexPath)
      : options.spaFallback && existsSync(indexPath);

  // Reorder `Accept-Encoding` before @fastify/static reads it so that
  // brotli is always preferred over gzip regardless of the client's
  // ordering. We also strip encodings we cannot serve so the plugin
  // never tries to look up `.deflate` siblings (which Vite does not
  // emit).
  //
  // Encapsulated in this plugin's scope: only routes registered via
  // @fastify/static below see the rewritten header.
  fastify.addHook('onRequest', async (request) => {
    const accepted = parseAcceptEncoding(
      request.headers['accept-encoding'],
    );
    const forwarded = buildForwardedAcceptEncoding(accepted);
    if (forwarded.length > 0) {
      request.headers['accept-encoding'] = forwarded;
    } else {
      delete request.headers['accept-encoding'];
    }
  });

  // Vary must be present on EVERY response — including the identity
  // branch — so an intermediary cache does not collapse the gzip and
  // identity variants into a single cache entry.
  fastify.addHook('onSend', async (_request, reply, payload) => {
    const existing = reply.getHeader('vary');
    if (!existing) {
      reply.header('vary', 'Accept-Encoding');
    } else if (typeof existing === 'string') {
      const has = existing
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .includes('accept-encoding');
      if (!has) {
        reply.header('vary', `${existing}, Accept-Encoding`);
      }
    } else if (Array.isArray(existing)) {
      const flat = existing
        .flatMap((entry) =>
          String(entry)
            .split(',')
            .map((part) => part.trim().toLowerCase()),
        )
        .filter(Boolean);
      if (!flat.includes('accept-encoding')) {
        reply.header('vary', [...existing, 'Accept-Encoding']);
      }
    }
    return payload;
  });

  await fastify.register(fastifyStatic, {
    root: rootResolved,
    // `prefix: '/'` because the outer plugin scope already applied
    // the consumer's URL prefix. See note at the top of the function.
    prefix: '/',
    // Built-in pre-compression: serves `.br` then `.gz` based on
    // Accept-Encoding and sets Content-Encoding accordingly.
    preCompressed: true,
    decorateReply: true,
    wildcard: !spaFallback,
  });

  if (spaFallback) {
    // Manual SPA fallback: any GET/HEAD inside this scope that does
    // not match a real file responds with index.html so the SPA
    // router can take over. We register at `/*` (relative to the
    // already-prefixed scope) rather than `${prefix}*` to avoid
    // double-prefixing.
    fastify.get('/*', (_request, reply) => {
      return reply.sendFile('index.html');
    });
  }
};

export default staticAssetsPlugin;
