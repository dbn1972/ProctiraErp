import type { Metadata } from 'next';
import { headers } from 'next/headers';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'ProctiraERP Platform Admin',
  description:
    'Internal tooling for tenant management, plugin marketplace, theme review, break-glass access, and system health.',
};

/** Root layout for the Platform Admin Console. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // PRC-M003: the nonce CSP requires dynamic rendering so Next.js can stamp each request's
  // nonce on its scripts; reading the request headers opts every page out of static output.
  await headers();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
