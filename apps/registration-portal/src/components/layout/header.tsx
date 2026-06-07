'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/language-switcher';

/**
 * Public header for the Registration Portal.
 *
 * Matches the Figma landing design:
 *   Logo · Home | Find Schools | Register | Track Application | Help · Language switcher · Login
 */
export function Header() {
  const t = useTranslations('nav');

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5" aria-label="ProctiraERP">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-inner">
            <span className="text-base font-extrabold">P</span>
          </div>
          <span className="text-base font-bold tracking-tight text-gray-900">
            Proctira<span className="text-primary-600">ERP</span>
          </span>
        </Link>

        {/* Center nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          <Link
            href="/"
            className="rounded-md px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            {t('home')}
          </Link>
          <Link
            href="/schools"
            className="rounded-md px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            {t('findSchools')}
          </Link>
          <Link
            href="/"
            className="rounded-md px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            {t('register')}
          </Link>
          <Link
            href="/track"
            className="rounded-md px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            {t('trackStatus')}
          </Link>
        </nav>

        {/* Right cluster */}
        <div className="ms-auto flex items-center gap-3">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
