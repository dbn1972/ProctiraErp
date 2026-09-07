'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';

const PRIMARY_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/docs', label: 'Docs' },
  { href: '/docs', label: 'API Reference' },
  { href: '/marketplace', label: 'Plugins' },
];

const MenuIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

const CloseIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

/**
 * Marketing header with desktop nav plus a disclosure menu on small viewports.
 * Pixel-width Playwright projects hide `md:flex` links otherwise.
 */
export function SiteHeader({ brand }: { brand: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 md:gap-6 md:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2 text-gray-900 md:gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-base font-extrabold text-white shadow-inner">
            P
          </span>
          <span className="min-w-0 truncate">{brand}</span>
          <span className="hidden shrink-0 rounded-md border border-gray-200 bg-primary-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-700 sm:inline">
            Developers
          </span>
        </Link>
        <nav className="hidden gap-1 md:flex" aria-label="Main">
          {PRIMARY_LINKS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link
            href="/dashboard"
            className="hidden rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 md:inline-flex"
          >
            Get API key
          </Link>
          <button
            type="button"
            className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:hidden"
            aria-expanded={open}
            aria-controls="developer-mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open ? (
        <div id="developer-mobile-nav" className="border-t border-gray-200 md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3" aria-label="Main">
            {PRIMARY_LINKS.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-lg bg-primary-600 px-3 py-2 text-center text-sm font-semibold text-white"
            >
              Get API key
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
