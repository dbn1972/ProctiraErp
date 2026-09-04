'use client';

/**
 * Registration portal chrome — sticky header + navy footer matching
 * redesign/registration/*.html with ProctiraERP branding.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, Phone, X } from 'lucide-react';

import { LanguageSelector } from '@/components/LanguageSelector';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/register', label: 'Home', match: (p: string) => p === '/register' },
  {
    href: '/register/schools',
    label: 'Find Schools',
    match: (p: string) => p.startsWith('/register/schools'),
  },
  {
    href: '/register/apply',
    label: 'Register',
    match: (p: string) =>
      p.startsWith('/register/apply') || p.startsWith('/register/success'),
  },
  {
    href: '/track',
    label: 'Track Application',
    match: (p: string) => p.startsWith('/track'),
  },
] as const;

function BrandMark({ className }: { className?: string }): JSX.Element {
  return (
    <Link
      href="/register"
      className={cn('inline-flex items-center gap-2.5 text-foreground', className)}
      aria-label="ProctiraERP Student Registration Portal"
    >
      <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)] text-base font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.25)]">
        P
      </span>
      <b className="text-base font-bold tracking-tight">
        Proctira<span className="text-[var(--color-primary-600)]">ERP</span>
      </b>
    </Link>
  );
}

export function RegistrationPortalHeader(): JSX.Element {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-white/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-6 px-4 sm:px-6">
        <BrandMark />

        <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                  active
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-700)]'
                    : 'text-muted-foreground hover:bg-slate-50 hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <LanguageSelector />
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-muted-foreground md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          className="flex flex-col gap-0.5 border-t border-border bg-white px-3 py-3 md:hidden"
          aria-label="Mobile"
        >
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  'rounded-md px-3.5 py-3 text-base font-semibold',
                  active
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-700)]'
                    : 'text-muted-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}

export function RegistrationPortalFooter({
  compact = false,
}: {
  compact?: boolean;
}): JSX.Element {
  const year = new Date().getFullYear();

  if (compact) {
    return (
      <footer className="mt-auto bg-[var(--color-navy-900)] text-[#AEB9D6]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-2.5 px-4 py-5 text-xs sm:px-6">
          <span className="inline-flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-[var(--color-primary-300)]" />
            Helpline <b className="text-sm font-semibold tracking-wide text-white">155335</b>
            · toll-free, Mon–Sat 8 am–8 pm
          </span>
          <span>© {year} ProctiraERP · Student Registration Portal</span>
          <div className="ms-auto flex gap-4">
            <Link href="/legal/privacy" className="hover:text-white">
              Privacy Policy
            </Link>
            <Link href="/legal/terms" className="hover:text-white">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="mt-auto bg-[var(--color-navy-900)] text-[#AEB9D6]">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-8 px-4 pb-0 pt-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="mb-3 flex items-center gap-2.5 text-white">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)] text-sm font-extrabold">
              P
            </span>
            <b className="font-bold">
              Proctira<span className="text-[var(--color-primary-400)]">ERP</span>
            </b>
          </div>
          <p className="m-0 max-w-[40ch] text-sm leading-relaxed text-[#8B97B8]">
            Student Registration Portal for government schools. A free service —
            no fees, no agents, no middlemen.
          </p>
        </div>
        <div>
          <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#5E6C90]">
            Portal
          </h4>
          <div className="flex flex-col gap-2.5 text-sm">
            <Link href="/register/schools" className="hover:text-white">
              Find Schools
            </Link>
            <Link href="/register/apply" className="hover:text-white">
              Register
            </Link>
            <Link href="/track" className="hover:text-white">
              Track Application
            </Link>
            <Link href="/register#faq" className="hover:text-white">
              Help &amp; FAQ
            </Link>
          </div>
        </div>
        <div>
          <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#5E6C90]">
            Helpline
          </h4>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3.5">
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[rgba(99,102,241,.2)]">
              <Phone className="h-4 w-4 text-[var(--color-primary-300)]" />
            </span>
            <div>
              <b className="block text-xl tracking-wide text-white">155335</b>
              <span className="text-xs text-[#8B97B8]">Toll-free · Mon–Sat, 8 am–8 pm</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-8 flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-white/10 px-4 py-4 text-xs text-[#5E6C90] sm:px-6">
        <span>© {year} ProctiraERP · Student Registration Portal</span>
        <div className="ms-auto flex gap-4">
          <Link href="/legal/privacy" className="text-[#8B97B8] hover:text-white">
            Privacy Policy
          </Link>
          <Link href="/legal/terms" className="text-[#8B97B8] hover:text-white">
            Terms of Service
          </Link>
          <Link href="/legal/accessibility" className="text-[#8B97B8] hover:text-white">
            Accessibility
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function RegistrationPortalShell({
  children,
  compactFooter = false,
}: {
  children: React.ReactNode;
  compactFooter?: boolean;
}): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-foreground">
      <RegistrationPortalHeader />
      <div className="flex-1">{children}</div>
      <RegistrationPortalFooter compact={compactFooter} />
    </div>
  );
}
