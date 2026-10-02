/**
 * SEO helpers: canonical site origin and indexability, derived from env so
 * preview / staging builds never ask search engines to index them.
 *
 * - `NEXT_PUBLIC_SITE_URL`  canonical origin (default https://proctira.org).
 * - `NEXT_PUBLIC_SITE_ENV`  deployment tier; anything other than `production`
 *   (e.g. `preview`, `staging`) builds with `noindex` + `Disallow: /`.
 *   Unset keeps the production default so existing prod deploys are unchanged.
 * - Non-production `NODE_ENV` (dev/test) is always `noindex`.
 */
type Env = Record<string, string | undefined>;

export const DEFAULT_SITE_URL = 'https://proctira.org';

/** Public routes listed in sitemap.xml. Keep in sync with `src/app`. */
export const PUBLIC_ROUTES = [
  '/',
  '/product',
  '/about',
  '/installation',
  '/security',
  '/compliance',
  '/status',
  '/contact',
  '/privacy',
  '/terms',
  '/cookies',
  '/legal',
] as const;

export function getSiteUrl(env: Env = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        return url.origin;
      }
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_SITE_URL;
}

export function isIndexable(env: Env = process.env): boolean {
  if (env.NODE_ENV && env.NODE_ENV !== 'production') return false;
  const tier = env.NEXT_PUBLIC_SITE_ENV?.trim().toLowerCase();
  if (tier && tier !== 'production') return false;
  return true;
}
