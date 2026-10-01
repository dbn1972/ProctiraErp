/**
 * Public-website site helpers.
 */

/** Canonical source repository. Marketing copy must not invent a different org. */
export const SOURCE_REPOSITORY_URL = 'https://github.com/dbn1972/ProctiraErp';

type Env = Record<string, string | undefined>;

/** Explicit production tier (see `@/lib/seo`): config gaps fail loudly here. */
export function isProductionTier(env: Env = process.env): boolean {
  return env.NEXT_PUBLIC_SITE_ENV?.trim().toLowerCase() === 'production';
}

/** Validated `NEXT_PUBLIC_WEB_APP_URL` origin+path (no trailing slash), or null. */
export function readWebAppBaseUrl(env: Env = process.env): string | null {
  const base = env.NEXT_PUBLIC_WEB_APP_URL?.trim().replace(/\/$/, '');
  return base && /^https?:\/\//i.test(base) ? base : null;
}

/**
 * Login lives on the main web app, not this marketing surface.
 * Prefer `NEXT_PUBLIC_WEB_APP_URL` (no trailing slash). Outside the production
 * tier it falls back to `/contact` so the header never points at a dead
 * in-app `/login`; with `NEXT_PUBLIC_SITE_ENV=production` a missing/invalid
 * value throws so the build fails instead of shipping a placeholder login.
 */
export function getWebAppLoginUrl(env: Env = process.env): string {
  const base = readWebAppBaseUrl(env);
  if (base) return `${base}/login`;
  if (isProductionTier(env)) {
    throw new Error(
      'NEXT_PUBLIC_WEB_APP_URL must be an http(s) URL when NEXT_PUBLIC_SITE_ENV=production.',
    );
  }
  return '/contact';
}

/** Hostname for display (e.g. status page rows), or null when unset/invalid. */
export function displayHost(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}
