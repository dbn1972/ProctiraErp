'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getWebAppLoginUrl } from '@/lib/site';
import { cn } from '@/lib/utils';

const PRIMARY_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/product', label: 'Product' },
  { href: '/#solutions', label: 'Solutions' },
  { href: '/installation', label: 'Developers' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/about', label: 'Company' },
];

const LOGIN_HREF = getWebAppLoginUrl();

/**
 * Public site header with primary navigation, brand mark, and login CTA.
 *
 * Uses a disclosure pattern for the mobile menu (single button toggles a
 * panel and updates `aria-expanded`) so it works with screen readers and
 * keyboard navigation.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="ProctiraERP — go to home page"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
          >
            <span className="text-sm font-bold">O</span>
          </span>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            ProctiraERP
          </span>
        </Link>

        <nav
          className="hidden items-center gap-6 md:flex"
          aria-label="Primary"
        >
          {PRIMARY_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href={LOGIN_HREF}>Login</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/contact">Contact sales</Link>
          </Button>
        </div>

        <button
          type="button"
          className={cn(
            'inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground md:hidden',
            'hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div id="mobile-nav" className="border-t border-border md:hidden">
          <nav
            className="container flex flex-col gap-1 py-4"
            aria-label="Primary mobile"
          >
            {PRIMARY_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={LOGIN_HREF} onClick={() => setOpen(false)}>
                  Login
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/contact" onClick={() => setOpen(false)}>
                  Contact sales
                </Link>
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
