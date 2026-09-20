import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { FormConfigurationLoadResult } from '@/lib/server';

export function ConfigurationState({
  status,
  retryHref,
}: {
  status: Exclude<FormConfigurationLoadResult['status'], 'ready'>;
  retryHref: string;
}) {
  const t = useTranslations('registration');
  const unavailable = status === 'unavailable';
  const notFound = status === 'not_found';
  const title = unavailable
    ? t('configUnavailableTitle')
    : notFound
      ? t('configMissingTitle')
      : t('institutionRequiredTitle');
  const message = unavailable
    ? t('configUnavailableMessage')
    : notFound
      ? t('configMissingMessage')
      : t('institutionRequired');

  return (
    <div
      className={`card border ${unavailable ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}
      role="alert"
    >
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-gray-700">{message}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {unavailable ? (
          <a href={retryHref} className="btn-primary">
            {t('retryConfiguration')}
          </a>
        ) : null}
        <Link href="/schools" className={unavailable ? 'btn-secondary' : 'btn-primary'}>
          {t('chooseInstitution')}
        </Link>
      </div>
    </div>
  );
}
