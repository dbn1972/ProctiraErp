'use client';

import { useTranslations } from 'next-intl';

/**
 * Public footer with copyright and legal/contact links.
 */
export function Footer() {
  const t = useTranslations('footer');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/10 bg-primary-900 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-extrabold text-white">
            P
          </div>
          <span className="text-sm font-bold tracking-tight">
            Proctira<span className="text-primary-300">ERP</span>
          </span>
        </div>
        <p className="text-sm text-white/60 sm:ms-4">{t('copyright', { year: String(year) })}</p>
        <div className="flex gap-6 sm:ms-auto">
          <a href="#" className="text-sm text-white/75 hover:text-white">
            {t('privacy')}
          </a>
          <a href="#" className="text-sm text-white/75 hover:text-white">
            {t('terms')}
          </a>
          <a href="#" className="text-sm text-white/75 hover:text-white">
            {t('contact')}
          </a>
        </div>
      </div>
    </footer>
  );
}
