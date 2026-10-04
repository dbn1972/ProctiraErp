import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import { CookieConsent } from '@/components/cookie-consent';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { getSiteUrl, isIndexable } from '@/lib/seo';
import '@/styles/globals.css';

/**
 * Variable Inter (latin, weights 100–900), self-hosted under `src/fonts`
 * (SIL OFL). `next/font/local` keeps `next build` off fonts.googleapis.com.
 * CSS variable name matches the previous `next/font/google` setup.
 */
const inter = localFont({
  src: '../fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-sans',
});

const siteUrl = getSiteUrl();
const indexable = isIndexable();
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'ProctiraERP — Education Management Platform',
    template: '%s · ProctiraERP',
  },
  description:
    'ProctiraERP is the open, multi-tenant education management platform for schools, districts, and ministries. Secure, accessible, and built for global deployment.',
  applicationName: 'ProctiraERP',
  keywords: [
    'ProctiraERP',
    'education management',
    'EMIS',
    'school management',
    'district management',
    'ministry of education',
    'open source',
  ],
  authors: [{ name: 'ProctiraERP' }],
  openGraph: {
    type: 'website',
    siteName: 'ProctiraERP',
    title: 'ProctiraERP — Education Management Platform',
    description:
      'The open, multi-tenant education management platform for schools, districts, and ministries.',
    locale: 'en_US',
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ProctiraERP — Education Management Platform',
    description:
      'The open, multi-tenant education management platform for schools, districts, and ministries.',
  },
  // Preview/staging (NEXT_PUBLIC_SITE_ENV != production) builds serve noindex.
  robots: {
    index: indexable,
    follow: indexable,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#264684',
};

/**
 * Root layout for the public website.
 *
 * Provides:
 *  - Skip-to-content link for keyboard users (WCAG 2.4.1).
 *  - Global header and footer that link every required public property.
 *  - Self-hosted Inter (`next/font/local`) so static export does not fetch
 *    fonts.googleapis.com at build time.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-sans">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <CookieConsent />
      </body>
    </html>
  );
}
