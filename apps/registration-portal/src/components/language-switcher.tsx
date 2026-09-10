'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Globe } from 'lucide-react';
import { locales, type Locale } from '@/i18n/config';
import { setSessionLanguage } from '@/lib/api';

/** Display names for supported locales */
const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  ar: 'العربية',
  he: 'עברית',
};

/**
 * Language switcher for the public Registration Portal.
 *
 * Sets a `locale` cookie (1-year expiry) so the language is persisted across
 * sessions, and best-effort syncs the choice with the backend session via
 * `POST /registrations/language` (Requirement 16.5). Refreshes the route
 * so the new language is applied.
 */
export function LanguageSwitcher() {
  const currentLocale = useLocale();
  const router = useRouter();
  const t = useTranslations('nav');
  const [isPending, startTransition] = useTransition();

  function handleLocaleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newLocale = event.target.value;

    // 1) Persist for next request via cookie (1 year)
    document.cookie = `locale=${newLocale};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;

    // 2) Best-effort sync with backend session (non-blocking)
    void setSessionLanguage(newLocale).catch(() => {
      // Backend session sync is best-effort; cookie persistence is the source of truth.
    });

    // 3) Refresh the route so the next-intl request config picks up the new locale
    startTransition(() => router.refresh());
  }

  return (
    <label className="relative inline-flex items-center">
      <Globe
        className="pointer-events-none absolute start-2 h-4 w-4 text-gray-500"
        aria-hidden="true"
      />
      <span className="sr-only">{t('language')}</span>
      <select
        value={currentLocale}
        onChange={handleLocaleChange}
        disabled={isPending}
        aria-label={t('language')}
        className="appearance-none rounded-md border border-gray-300 bg-white py-1 pe-3 ps-7 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {localeNames[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
