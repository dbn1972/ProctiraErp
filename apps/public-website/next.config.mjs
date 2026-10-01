const isDev = process.env.NODE_ENV !== 'production';

/**
 * Production-tier builds (NEXT_PUBLIC_SITE_ENV=production) must not ship the
 * "/contact" login placeholder: fail fast when NEXT_PUBLIC_WEB_APP_URL is unset.
 * @param {Record<string, string | undefined>} [env]
 */
export function assertProductionEnv(env = process.env) {
  if (env.NEXT_PUBLIC_SITE_ENV?.trim().toLowerCase() !== 'production') return;
  const base = env.NEXT_PUBLIC_WEB_APP_URL?.trim();
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error(
      '[public-website] NEXT_PUBLIC_WEB_APP_URL must be an http(s) URL when NEXT_PUBLIC_SITE_ENV=production.',
    );
  }
}
assertProductionEnv();

/**
 * Baseline security headers for every route.
 * Next.js injects inline bootstrap scripts without a nonce, so script-src keeps
 * 'unsafe-inline'; frame-ancestors/object-src/base-uri/form-action are locked.
 * No third-party origins are allowed (no analytics/trackers are loaded).
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? ' ws:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
