import { ApplySchoolHeading } from '@/components/registration/apply-school-heading';
import { ConfigurationState } from '@/components/registration/configuration-state';
import { ReviewStep } from '@/components/registration/review-step';
import { loadFormConfiguration, lookupInstitutionName } from '@/lib/server';

interface PageProps {
  params: Promise<{ institutionType: string }>;
  searchParams: Promise<{ institutionId?: string | string[] }>;
}

/** Step 3 — review and submit against the exact published form version. */
export default async function ApplyReviewPage({ params, searchParams }: PageProps) {
  const { institutionType } = await params;
  const query = await searchParams;
  const institutionId = typeof query.institutionId === 'string' ? query.institutionId : undefined;
  const result = await loadFormConfiguration(institutionId);
  const retryHref = `/apply/${encodeURIComponent(institutionType)}/review${
    institutionId ? `?institutionId=${encodeURIComponent(institutionId)}` : ''
  }`;

  if (result.status !== 'ready') {
    return <ConfigurationState status={result.status} retryHref={retryHref} />;
  }

  const institutionName = await lookupInstitutionName(result.configuration.institutionId);
  return (
    <div className="space-y-6">
      <ApplySchoolHeading institutionType={institutionType} institutionName={institutionName} />
      <ReviewStep
        institutionType={institutionType}
        configuration={result.configuration}
        institutionName={institutionName}
      />
    </div>
  );
}
