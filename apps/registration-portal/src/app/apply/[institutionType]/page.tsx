import { useTranslations } from 'next-intl';
import { PersonalInfoForm } from '@/components/registration/personal-info-form';
import { loadFormConfiguration } from '@/lib/server';

interface PageProps {
  params: Promise<{ institutionType: string }>;
}

/**
 * Step 1 — Personal information page.
 *
 * Loads the form configuration for the requested institution type as a
 * Server Component, then renders the multi-page form. Configurable fields
 * (text/select/etc.) are placed alongside the standard applicant fields;
 * file fields are reserved for the next step.
 */
export default async function ApplyPersonalPage({ params }: PageProps) {
  const { institutionType } = await params;
  const config = await loadFormConfiguration(institutionType);
  const customFields = config.fields.filter((f) => f.type !== 'file');

  return (
    <div className="space-y-6">
      <ApplyHeader institutionType={institutionType} />
      <PersonalInfoForm institutionType={institutionType} customFields={customFields} />
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
