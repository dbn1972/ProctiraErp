/**
 * New examination form page.
 *
 * Validates: Requirement 10.1 — define examination cycles with subjects,
 * centres, grading schemes, and a start date ≥7 days ahead.
 * Wired to POST /examinations via gateway examinationPlugin.
 */
import { PageHeader } from '@/components/page';
import { listInstitutions } from '@/lib/api/institutions';

import { NewExaminationForm } from './new-examination-form';

export const dynamic = 'force-dynamic';

export default async function NewExaminationPage() {
  const institutions = await listInstitutions({ pageSize: 200 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule examination"
        description="Creates via POST /examinations — name, code, academic period, window, subject, centre, and grading scheme (Requirement 10.1 / 10.7)."
      />
      <NewExaminationForm
        institutions={institutions.map((i) => ({
          id: i.id,
          name: i.name,
          code: i.code,
        }))}
      />
    </div>
  );
}
