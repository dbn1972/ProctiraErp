'use client';

import { useTranslations } from 'next-intl';

/**
 * Public footer with copyright and legal/contact links.
 */
export function Footer() {
  const t = useTranslations('footer');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-200 bg-primary-900 text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-white/70">{t('copyright', { year: String(year) })}</p>
          <div className="flex gap-6">
            <a href="#" className="text-sm text-white/80 hover:text-white">
              {t('privacy')}
            </a>
            <a href="#" className="text-sm text-white/80 hover:text-white">
              {t('terms')}
            </a>
            <a href="#" className="text-sm text-white/80 hover:text-white">
              {t('contact')}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
