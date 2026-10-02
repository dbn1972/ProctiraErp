/**
 * Content-Security-Policy for apps/web (PRC-H024 / PRC-H033).
 *
 * Nonce-based, `'strict-dynamic'` script policy: only scripts carrying the
 * per-request nonce (Next.js stamps it on its own bootstrap/RSC scripts when
 * it sees the nonce in the request's CSP header; the root layout stamps it on
 * the theme boot script) and scripts they load may run. There is no
 * `'unsafe-inline'` for scripts, so inline handlers and `javascript:` URLs
 * cannot execute even if one slips past safeHref.
 *
 * Styles keep `'unsafe-inline'`: React `style={...}` attributes, Radix
 * positioning and the SSR tenant-theme `<style>` block are inline. Style
 * injection cannot execute script.
 *
 * Edge-runtime safe (used from middleware): Web Crypto + btoa only.
 */

export const CSP_HEADER = 'Content-Security-Policy';
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
/** Request header the root layout reads to stamp its own inline scripts. */
export const NONCE_HEADER = 'x-nonce';

export interface CspOptions {
  nonce: string;
  /** Development adds `'unsafe-eval'` (React dev tooling / webpack eval source maps) and ws: for HMR. */
  isDev: boolean;
  /** Extra origins the browser fetches directly (gateway, telemetry). Invalid entries are dropped. */
  connectSrc?: readonly string[];
  /** Optional reporting endpoint (`report-uri`). */
  reportUri?: string;
}

/** 128-bit random nonce, base64-encoded. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Normalises a configured origin to `scheme://host[:port]`, or null when it is not http(s)/ws(s). */
export function toCspOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, isDev } = options;
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(nonce)) {
    throw new Error('CSP nonce must be a base64 token of at least 16 characters');
  }
  const connect = new Set<string>(["'self'"]);
  for (const origin of options.connectSrc ?? []) {
    const normalised = toCspOrigin(origin);
    if (normalised) connect.add(normalised);
  }
  if (isDev) {
    connect.add('ws:');
    connect.add('wss:');
  }

  const scriptSrc = [`'nonce-${nonce}'`, "'strict-dynamic'"];
  if (isDev) scriptSrc.push("'unsafe-eval'");

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', scriptSrc],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    // Tenant logos can be hosted on a CDN; blob:/data: cover photo previews and downloads.
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', [...connect]],
    // 'strict-dynamic' disables host-source fallbacks, so the service worker needs its own directive.
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['media-src', ["'self'", 'blob:']],
    ['frame-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  if (!isDev) directives.push(['upgrade-insecure-requests', []]);
  if (options.reportUri) directives.push(['report-uri', [options.reportUri]]);

  return directives
    .map(([name, values]) => (values.length ? `${name} ${values.join(' ')}` : name))
    .join('; ');
}

/**
 * Builds the policy from the runtime environment. `CSP_CONNECT_SRC` is a
 * comma/space separated list of extra origins; `CSP_REPORT_ONLY=true` lets an
 * operator stage the policy without enforcing it.
 */
export function cspFromEnv(
  nonce: string,
  env: Record<string, string | undefined> = process.env,
): { header: string; value: string } {
  const extra = (env['CSP_CONNECT_SRC'] ?? '').split(/[\s,]+/).filter(Boolean);
  const value = buildContentSecurityPolicy({
    nonce,
    isDev: env['NODE_ENV'] === 'development',
    connectSrc: [env['NEXT_PUBLIC_GATEWAY_URL'] ?? '', ...extra],
    reportUri: env['CSP_REPORT_URI'] || undefined,
  });
  const header = env['CSP_REPORT_ONLY'] === 'true' ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;
  return { header, value };
}
