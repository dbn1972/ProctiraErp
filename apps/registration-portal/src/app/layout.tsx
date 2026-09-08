import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { getDirection } from '@/i18n/config';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'ProctiraERP Registration Portal',
  description: 'Public registration portal for student enrollment applications',
};

/**
 * Root layout for the registration portal.
 * Public-facing — no authentication required.
 * Supports RTL/LTR direction based on locale.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const direction = getDirection(locale);

  return (
    <html lang={locale} dir={direction} suppressHydrationWarning>
      <body className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
