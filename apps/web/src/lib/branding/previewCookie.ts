/**
 * Tenant branding preview-cookie helpers (Task 59.2 / Task 58.3).
 *
 * Settings → Branding has a "Preview" toggle that flips a session cookie
 * the gateway recognises (Task 58.3). When the cookie is present AND the
 * caller carries the `branding:preview` permission, the active tenant
 * theme endpoint returns the saved DRAFT tokens instead of the published
 * ones, so the user can validate their changes end-to-end before hitting
 * Publish.
 *
 * Source of truth for the cookie name: `PREVIEW_COOKIE_NAME` exported
 * from `@proctira/backend-tenant/branding-routes`. We keep a synchronised
 * constant here so the web bundle does not import a backend module.
 *
 * The cookie:
 *   • is `Path=/` (so every API call carries it).
 *   • is `SameSite=Lax` (the gateway is same-site, no cross-site preview).
 *   • is **not** `Secure` in dev so it works over `http://localhost`; in
 *     production the layer in front (`Set-Cookie` from the route handler)
 *     promotes preview cookies to `Secure`.
 *   • value is opaque — any non-empty string opts the request into the
 *     preview lookup; the actual draft tokens are read server-side.
 *
 * The helpers are SSR-safe: they no-op (or report `false`) when
 * `document` is undefined.
 */

/** Cookie name shared with `packages/backend/tenant/src/branding-routes.ts`. */
export const PREVIEW_COOKIE_NAME = 'Tenant-Theme-Preview';

/** Default opaque value written by the toggle. */
export const PREVIEW_COOKIE_DEFAULT_VALUE = 'draft';

/** Default `Max-Age` for the preview cookie (one hour). */
export const PREVIEW_COOKIE_MAX_AGE_SECONDS = 60 * 60;

function isBrowser(): boolean {
  return typeof document !== 'undefined';
}

function escapeCookieValue(value: string): string {
  // Cookie values may not contain `;` or whitespace per RFC 6265 §4.1.1.
  return encodeURIComponent(value);
}

/**
 * Returns `true` when the preview cookie is set on the current document.
 *
 * Treats any non-empty value as preview mode (matches the gateway, which
 * only inspects the boolean presence of the cookie).
 */
export function isBrandingPreviewEnabled(): boolean {
  if (!isBrowser()) return false;
  const target = `${PREVIEW_COOKIE_NAME}=`;
  for (const segment of (document.cookie || '').split(';')) {
    const trimmed = segment.trimStart();
    if (trimmed.startsWith(target)) {
      const value = trimmed.slice(target.length);
      if (value.length > 0) return true;
    }
  }
  return false;
}

/**
 * Enables branding preview by writing the cookie. The gateway reads it on
 * the next API request and returns draft tokens to permitted callers.
 */
export function enableBrandingPreview(
  value: string = PREVIEW_COOKIE_DEFAULT_VALUE,
  options: {
    maxAgeSeconds?: number;
    path?: string;
    sameSite?: 'Lax' | 'Strict' | 'None';
    secure?: boolean;
  } = {},
): void {
  if (!isBrowser()) return;
  const {
    maxAgeSeconds = PREVIEW_COOKIE_MAX_AGE_SECONDS,
    path = '/',
    sameSite = 'Lax',
    secure = window.location?.protocol === 'https:',
  } = options;
  const parts = [
    `${PREVIEW_COOKIE_NAME}=${escapeCookieValue(value)}`,
    `Path=${path}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    `SameSite=${sameSite}`,
  ];
  if (secure) parts.push('Secure');
  document.cookie = parts.join('; ');
}

/**
 * Disables branding preview by expiring the cookie. The gateway then
 * resumes returning published tokens for the next request.
 */
export function disableBrandingPreview(options: { path?: string } = {}): void {
  if (!isBrowser()) return;
  const { path = '/' } = options;
  document.cookie = `${PREVIEW_COOKIE_NAME}=; Path=${path}; Max-Age=0; SameSite=Lax`;
}

/**
 * Convenience toggler. Returns the resulting preview state so the caller
 * can update its UI without re-reading the cookie.
 */
export function toggleBrandingPreview(): boolean {
  if (isBrandingPreviewEnabled()) {
    disableBrandingPreview();
    return false;
  }
  enableBrandingPreview();
  return true;
}
