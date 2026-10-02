/**
 * PRC-H009: baseline security headers for this Next app (previously none were sent).
 * Next's runtime needs inline scripts/styles without a nonce pipeline; dev also needs eval.
 */
function originOf(url) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export function buildSecurityHeaders(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const connect = ["'self'", originOf(env.NEXT_PUBLIC_API_URL)].filter(Boolean);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
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
