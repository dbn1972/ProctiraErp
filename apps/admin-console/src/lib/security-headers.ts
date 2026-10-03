/**
 * PRC-M003: security headers for the Platform Admin Console.
 *
 * The console exposes high-impact buttons (tenant decommission, plugin approve, break-glass
 * approve) and renders vendor-supplied plugin/theme strings, so it must not be frameable and
 * scripts are restricted to per-request nonces. Static headers are also declared in
 * next.config.mjs so they cover routes the middleware skips (_next assets, api).
 */

/** Static headers applied to every response (mirrored in next.config.mjs). */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** Generate a base64 nonce using Web Crypto (available in the Edge middleware runtime). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Build the Content-Security-Policy for a document response. `dev` relaxes script-src for the
 * Next.js dev runtime (eval-based HMR) only.
 */
export function buildContentSecurityPolicy(nonce: string, dev = false): string {
  const scriptSrc = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`];
  if (dev) scriptSrc.push(`'unsafe-eval'`);
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    // Next/Tailwind emit inline style attributes; no inline scripts are allowed.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
