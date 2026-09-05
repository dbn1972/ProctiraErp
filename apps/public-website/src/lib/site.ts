/**
 * Public-website site helpers.
 */

/**
 * Login lives on the main web app, not this marketing surface.
 * Prefer `NEXT_PUBLIC_WEB_APP_URL` (no trailing slash). Falls back to
 * `/contact` so the header never points at a dead in-app `/login` route.
 */
export function getWebAppLoginUrl(): string {
  const base = process.env.NEXT_PUBLIC_WEB_APP_URL?.trim().replace(/\/$/, '');
  if (base && /^https?:\/\//i.test(base)) {
    return `${base}/login`;
  }
  return '/contact';
}
