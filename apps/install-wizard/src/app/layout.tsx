import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProctiraERP Setup Wizard',
  description: 'First-run configuration wizard for ProctiraERP Unified Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-gray-200 bg-white px-6 py-4">
            <div className="mx-auto flex max-w-4xl items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-700">
                <span className="text-sm font-bold text-white">O</span>
              </div>
              <h1 className="text-lg font-semibold text-gray-900">
                ProctiraERP Setup Wizard
              </h1>
            </div>
          </header>
          <main className="flex-1 px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
