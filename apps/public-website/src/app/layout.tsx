import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import '@/styles/globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://proctira.org'),
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
    url: 'https://proctira.org',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ProctiraERP — Education Management Platform',
    description:
      'The open, multi-tenant education management platform for schools, districts, and ministries.',
  },
  robots: {
    index: true,
    follow: true,
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
 *  - Inter font from Google Fonts via a stylesheet link to avoid runtime
 *    network calls during static export.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      </body>
    </html>
  );
}
