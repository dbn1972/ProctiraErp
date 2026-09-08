import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProctiraERP Setup Wizard',
  description: 'First-run configuration wizard for ProctiraERP Unified Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 bg-[radial-gradient(700px_420px_at_50%_-10%,theme(colors.primary.50)_0%,transparent_55%)]">
        <div className="flex min-h-screen flex-col">
          <main className="flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
        </div>
      </body>
    </html>
  );
}
