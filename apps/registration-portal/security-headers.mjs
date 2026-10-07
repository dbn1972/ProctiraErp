/**
 * PRC-L226 / PRC-H009 (same root cause): baseline security headers for the
 * public registration portal, which previously sent none.
 *
 * The portal embeds a Leaflet map whose marker images come from unpkg.com and
 * whose tiles come from the OpenStreetMap tile servers, so `img-src` permits
 * those origins; everything else is `'self'`. Clickjacking is blocked with
 * `frame-ancestors 'none'` + `X-Frame-Options: DENY`.
 */
export function buildSecurityHeaders(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const csp = [
    "default-src 'self'",
    // Next's runtime needs inline scripts/styles; dev also needs eval.
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    // Leaflet marker icons (unpkg) + OSM raster tiles.
    "img-src 'self' data: blob: https://unpkg.com https://*.tile.openstreetmap.org",
    "font-src 'self' data:",
    "connect-src 'self' https://*.tile.openstreetmap.org",
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
