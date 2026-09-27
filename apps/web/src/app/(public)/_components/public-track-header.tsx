'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { LanguageSelector } from '@/components/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useBrand } from '@/providers/BrandConfigProvider';

/**
 * Anonymous chrome for `/track`. Marketing nav targets (`/features`,
 * `/pricing`, `/about`, `/contact`, `/demo`) are not routes in this app,
 * so they are not offered here.
 */
export function PublicTrackHeader(): JSX.Element {
  const tNav = useTranslations('marketing.nav');
  const tCta = useTranslations('marketing.cta');
  const tTracking = useTranslations('tracking');
  const { name } = useBrand();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-[hsl(var(--background))]/95 px-4 backdrop-blur-sm sm:px-6">
      <Link
        href="/track"
        className="inline-flex min-h-12 items-center rounded-md text-lg font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {name}
      </Link>
      <nav aria-label={tNav('primaryLabel')} className="flex items-center gap-1 sm:gap-2">
        <Link
          href="/track"
          className="inline-flex min-h-12 items-center rounded-md px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {tTracking('title')}
        </Link>
        <ThemeToggle />
        <LanguageSelector />
        <Link
          href="/login"
          className="inline-flex min-h-12 items-center rounded-md px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {tCta('signIn')}
        </Link>
      </nav>
    </header>
  );
}
