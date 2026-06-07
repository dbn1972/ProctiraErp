import { DocumentsStep } from '@/components/registration/documents-step';
import { StepIndicator } from '@/components/registration/step-indicator';
import { loadFormConfiguration } from '@/lib/server';

interface PageProps {
  params: { institutionType: string };
}

/**
 * Step 2 — Documents page.
 *
 * Reads file-typed configurable fields from the institution-type form
 * configuration and renders one upload slot per required document.
 */
export default async function ApplyDocumentsPage({ params }: PageProps) {
  const config = await loadFormConfiguration(params.institutionType);
  const fileFields = config.fields.filter((f) => f.type === 'file');

  return (
    <div className="space-y-6">
      <StepIndicator currentStep="documents" />
      <DocumentsStep institutionType={params.institutionType} fileFields={fileFields} />
    </div>
  );
}
