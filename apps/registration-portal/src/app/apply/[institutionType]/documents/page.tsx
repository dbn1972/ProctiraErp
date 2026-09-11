import { DocumentsStep } from '@/components/registration/documents-step';
import { loadFormConfiguration } from '@/lib/server';

interface PageProps {
  params: Promise<{ institutionType: string }>;
}

/**
 * Step 2 — Documents page.
 *
 * Reads file-typed configurable fields from the institution-type form
 * configuration and renders one upload slot per required document.
 */
export default async function ApplyDocumentsPage({ params }: PageProps) {
  const { institutionType } = await params;
  const config = await loadFormConfiguration(institutionType);
  const fileFields = config.fields.filter((f) => f.type === 'file');

  return (
    <div className="space-y-6">
      <DocumentsStep institutionType={institutionType} fileFields={fileFields} />
    </div>
  );
}
