import { ApplySchoolHeading } from '@/components/registration/apply-school-heading';
import { ConfigurationState } from '@/components/registration/configuration-state';
import { PersonalInfoForm } from '@/components/registration/personal-info-form';
import { loadFormConfiguration, lookupInstitutionName } from '@/lib/server';

interface PageProps {
  params: Promise<{ institutionType: string }>;
  searchParams: Promise<{ institutionId?: string | string[] }>;
}

/** Step 1 — load a published form only after a concrete school is selected. */
export default async function ApplyPersonalPage({ params, searchParams }: PageProps) {
  const { institutionType } = await params;
  const query = await searchParams;
  const institutionId = typeof query.institutionId === 'string' ? query.institutionId : undefined;
  const result = await loadFormConfiguration(institutionId);
  const retryHref = `/apply/${encodeURIComponent(institutionType)}${
    institutionId ? `?institutionId=${encodeURIComponent(institutionId)}` : ''
  }`;

  if (result.status !== 'ready') {
    return <ConfigurationState status={result.status} retryHref={retryHref} />;
  }

  const customFields = result.configuration.fields.filter((field) => field.type !== 'file');
  const institutionName = await lookupInstitutionName(result.configuration.institutionId);
  return (
    <div className="space-y-6">
      <ApplySchoolHeading institutionType={institutionType} institutionName={institutionName} />
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
