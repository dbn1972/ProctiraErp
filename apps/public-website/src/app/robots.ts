import type { MetadataRoute } from 'next';
import { getSiteUrl, isIndexable } from '@/lib/seo';

/** robots.txt — preview/staging builds disallow all crawling. */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  const base = getSiteUrl();
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
