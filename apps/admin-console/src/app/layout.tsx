import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'ProctiraERP Platform Admin',
  description:
    'Internal tooling for tenant management, plugin marketplace, theme review, break-glass access, and system health.',
};

/** Root layout for the Platform Admin Console. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
