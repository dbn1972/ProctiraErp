/**
 * Translate published tenant theme tokens into the field names the brand
 * normalizers read.
 *
 * ## Why this exists
 *
 * The gateway's `GET /tenant/branding` returns `getActiveBranding`'s result verbatim:
 *
 *   { tokens: { '--tenant-primary': 'hsl(...)', '--tenant-logo': 'url("...")', ... },
 *     revision: 3 }
 *
 * `normalizeBrandResponse` looks for top-level `name` / `logoUrl` / `primaryColor` /
 * `slug`, finds none of them nested under `tokens`, and returns the default brand for
 * every field. So a tenant could publish colours and a logo through
 * `/tenant/branding`, the request could succeed, and the UI would still render
 * ProctiraERP's palette — the publish looked like it worked and changed nothing.
 *
 * The token names are the CSS custom properties written by
 * `renderTenantThemeCSS` / `injectBrandCSSVariables` and validated at publish time by
 * `validateBrandingTokens` (`--tenant-logo`, `--tenant-favicon`, `--tenant-primary`,
 * `--tenant-accent`). This module is their inverse, so the SSR baseline, the client
 * runtime, and the published record all describe the same brand.
 *
 * Plain module, not part of `BrandConfigProvider`: that file is `'use client'`, so its
 * runtime exports become client-reference proxies when imported from a Server
 * Component. `lib/tenant-theme/server.ts` needs this mapping too.
 */

/** The token record shape a published theme carries. Values are CSS, so strings. */
export type PublishedTenantTokens = Record<string, unknown>;

/**
 * Brand fields recovered from a token record. Every field is optional: a tenant may
 * publish a single slot and inherit the platform default for the rest, which is the
 * behaviour `validateBrandingTokens` explicitly allows.
 */
export interface TenantTokenBrandFields {
  name?: string;
  shortName?: string;
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  favicon?: string;
  loginBackground?: string;
}

/**
 * Strip the CSS quoting that `renderTenantThemeCSS` adds.
 *
 * `--tenant-name` is emitted as a single-quoted CSS string (`'EduZo'`) with `\` and
 * `'` escaped, because it is consumed via `content: var(--tenant-name)`. Reading it
 * back as a brand name means undoing exactly that.
 */
function unquoteCssString(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
  const doubleQuote = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
  if (!quote && !doubleQuote) return trimmed;
  return trimmed.slice(1, -1).replace(/\\(['"\\])/g, '$1');
}

/**
 * Pull the URL out of a CSS `url(...)` value.
 *
 * Logo and favicon tokens are stored ready to drop into
 * `background-image: var(--tenant-logo)`, so they arrive as `url("/cdn/logo.svg")`.
 * A bare URL is accepted too — some publish paths store one — so this is tolerant
 * rather than strict.
 */
function unwrapCssUrl(value: string): string | undefined {
  const trimmed = value.trim();
  const match = /^url\(\s*(.*?)\s*\)$/i.exec(trimmed);
  const inner = match?.[1] ?? trimmed;
  const unquoted = unquoteCssString(inner);
  return unquoted.length > 0 ? unquoted : undefined;
}

function readToken(tokens: PublishedTenantTokens, key: string): string | undefined {
  const value = tokens[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Recognise a payload of the form `{ tokens: {...} }` and return the token record.
 *
 * Returns undefined for anything else, so callers can treat a flat brand payload and
 * a published-theme payload with the same code path.
 */
export function extractPublishedTokens(payload: unknown): PublishedTenantTokens | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const tokens = (payload as Record<string, unknown>)['tokens'];
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return undefined;
  return tokens as PublishedTenantTokens;
}

/** Map a published token record onto brand field names. */
export function tenantTokensToBrandFields(tokens: PublishedTenantTokens): TenantTokenBrandFields {
  const fields: TenantTokenBrandFields = {};

  const name = readToken(tokens, '--tenant-name');
  if (name) fields.name = unquoteCssString(name);

  const shortName = readToken(tokens, '--tenant-shortName');
  if (shortName) fields.shortName = unquoteCssString(shortName);

  const primary = readToken(tokens, '--tenant-primary');
  if (primary) fields.primaryColor = primary;

  const accent = readToken(tokens, '--tenant-accent');
  if (accent) fields.accentColor = accent;

  const logo = readToken(tokens, '--tenant-logo');
  if (logo) {
    const url = unwrapCssUrl(logo);
    if (url) fields.logoUrl = url;
  }

  const favicon = readToken(tokens, '--tenant-favicon');
  if (favicon) {
    const url = unwrapCssUrl(favicon);
    if (url) fields.favicon = url;
  }

  const loginBackground = readToken(tokens, '--tenant-login-bg');
  if (loginBackground) fields.loginBackground = loginBackground;

  return fields;
}
