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
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2" aria-label="ProctiraERP">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-600 text-white">
            <span className="text-sm font-bold">O</span>
          </div>
          <span className="text-base font-semibold text-gray-900">ProctiraERP</span>
        </Link>

        {/* Center nav */}
        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          <Link href="/" className="text-sm font-medium text-gray-600 hover:text-primary-600">
            {t('home')}
          </Link>
          <Link href="/schools" className="text-sm font-medium text-gray-600 hover:text-primary-600">
            {t('findSchools')}
          </Link>
          <Link href="/" className="text-sm font-medium text-gray-600 hover:text-primary-600">
            {t('register')}
          </Link>
          <Link href="/track" className="text-sm font-medium text-gray-600 hover:text-primary-600">
            {t('trackStatus')}
          </Link>
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
