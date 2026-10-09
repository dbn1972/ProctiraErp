/**
 * PRC-H009 / NEW-g1a_web-001 — baseline security headers for apps/web.
 *
 * apps/web previously set only `Referrer-Policy: no-referrer` on auth paths and
 * had NO Content-Security-Policy, X-Frame-Options or HSTS on any route. The app
 * renders the tenant theme via `dangerouslySetInnerHTML` (tenant-theme/server.ts)
 * and ships a synchronous inline theme-boot `<script>` (layout.tsx), so any
 * residual injection or clickjacking had no backstop. This module adds a strict
 * baseline applied to every route.
 *
 * CSP notes (nonce-less, as scoped by PRC-H009):
 *   - script-src 'self' 'unsafe-inline': the layout emits an inline theme-boot
 *     <script> via dangerouslySetInnerHTML and Next injects inline hydration
 *     bootstrap scripts. A nonce would have to thread through both, so we allow
 *     inline here (dev also needs 'unsafe-eval' for React Refresh / Turbopack).
 *   - style-src 'self' 'unsafe-inline': the layout injects the tenant theme as
 *     an inline <style data-tenant-theme> block, and Tailwind/next-intl emit
 *     inline styles. next/font self-hosts the Inter woff2 (font-src 'self').
 *   - img-src 'self' data: blob: https:: tenant branding logos/favicons may be
 *     served from a tenant CDN; data:/blob: cover inline SVG + object URLs.
 *   - connect-src 'self': the browser only talks to same-origin /api/* routes;
 *     the Next server (not the browser) fans out to the gateway.
 *   - frame-ancestors 'none' + X-Frame-Options DENY: clickjacking backstop.
 */
export function buildSecurityHeaders(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const headers = [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
  if (isProd) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
  }
  return headers;
}
