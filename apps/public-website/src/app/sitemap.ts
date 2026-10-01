import type { MetadataRoute } from 'next';
import { PUBLIC_ROUTES, getSiteUrl } from '@/lib/seo';

/** sitemap.xml for the public marketing routes. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  return PUBLIC_ROUTES.map((route) => ({
    url: route === '/' ? base : `${base}${route}`,
  }));
}
