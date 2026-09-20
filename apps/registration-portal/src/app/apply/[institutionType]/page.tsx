import { useTranslations } from 'next-intl';

import { ConfigurationState } from '@/components/registration/configuration-state';
import { PersonalInfoForm } from '@/components/registration/personal-info-form';
import { loadFormConfiguration } from '@/lib/server';

interface PageProps {
  params: Promise<{ institutionType: string }>;
  searchParams: Promise<{ institutionId?: string | string[] }>;
}

/** Step 1 — load a published form only after a concrete school is selected. */
export default async function ApplyPersonalPage({ params, searchParams }: PageProps) {
  const { institutionType } = await params;
  const query = await searchParams;
  const institutionId =
    typeof query.institutionId === 'string' ? query.institutionId : undefined;
  const result = await loadFormConfiguration(institutionId);
  const retryHref = `/apply/${encodeURIComponent(institutionType)}${
    institutionId ? `?institutionId=${encodeURIComponent(institutionId)}` : ''
  }`;

  if (result.status !== 'ready') {
    return <ConfigurationState status={result.status} retryHref={retryHref} />;
  }

  const customFields = result.configuration.fields.filter((field) => field.type !== 'file');
  return (
    <div className="space-y-6">
      <ApplyHeader institutionType={institutionType} />
      <PersonalInfoForm
        institutionType={institutionType}
        institutionId={result.configuration.institutionId}
        formConfigurationId={result.configuration.id}
        formConfigurationVersion={result.configuration.version}
        customFields={customFields}
      />
    </div>
  );
}

function ApplyHeader({ institutionType }: { institutionType: string }) {
  const t = useTranslations('registration');
  return (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">
        {institutionType}
      </p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900">{t('title')}</h1>
      <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>
    </div>
  );
}
