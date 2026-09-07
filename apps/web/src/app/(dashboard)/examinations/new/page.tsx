/**
 * New examination form page.
 *
 * Validates: Requirement 10.1 — define examination cycles with subjects,
 * centres, grading schemes, and a start date ≥7 days ahead.
 * Wired to POST /examinations via gateway examinationPlugin.
 */
import { listInstitutions } from '@/lib/api/institutions';

import { NewExaminationForm } from './new-examination-form';

export const dynamic = 'force-dynamic';

export default async function NewExaminationPage() {
  const institutions = await listInstitutions({ pageSize: 200 });

  return (
    <NewExaminationForm
      institutions={institutions.map((i) => ({
        id: i.id,
        name: i.name,
        code: i.code,
      }))}
    />
  );
}
