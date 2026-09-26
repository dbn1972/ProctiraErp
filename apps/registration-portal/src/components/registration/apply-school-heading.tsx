'use client';

import { useTranslations } from 'next-intl';

/** Apply-step title. Shows the school name when the directory returned one. */
export function ApplySchoolHeading({
  institutionType,
  institutionName,
}: {
  institutionType: string;
  institutionName: string | null;
}) {
  const t = useTranslations('registration');
  return (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">
        {institutionType}
      </p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900">{t('title')}</h1>
      <p className="mt-2 text-sm text-gray-600">{institutionName ?? t('subtitle')}</p>
    </div>
  );
}
