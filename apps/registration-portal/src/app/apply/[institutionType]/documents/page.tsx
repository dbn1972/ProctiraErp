import { ConfigurationState } from '@/components/registration/configuration-state';
import { DocumentsStep } from '@/components/registration/documents-step';
import { loadFormConfiguration } from '@/lib/server';

interface PageProps {
  params: Promise<{ institutionType: string }>;
  searchParams: Promise<{ institutionId?: string | string[] }>;
}

/** Step 2 — required documents from the selected institution's published form. */
export default async function ApplyDocumentsPage({ params, searchParams }: PageProps) {
  const { institutionType } = await params;
  const query = await searchParams;
  const institutionId = typeof query.institutionId === 'string' ? query.institutionId : undefined;
  const result = await loadFormConfiguration(institutionId);
  const retryHref = `/apply/${encodeURIComponent(institutionType)}/documents${
    institutionId ? `?institutionId=${encodeURIComponent(institutionId)}` : ''
  }`;

  if (result.status !== 'ready') {
    return <ConfigurationState status={result.status} retryHref={retryHref} />;
  }

  return (
    <div className="space-y-6">
      <DocumentsStep
        institutionType={institutionType}
        institutionId={result.configuration.institutionId}
        formConfigurationId={result.configuration.id}
        formConfigurationVersion={result.configuration.version}
        fileFields={result.configuration.fields.filter((field) => field.type === 'file')}
      />
    </div>
  );
}
