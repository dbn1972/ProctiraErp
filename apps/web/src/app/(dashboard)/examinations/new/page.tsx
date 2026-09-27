/**
 * New examination form page.
 *
 * Validates: Requirement 10.1 — define examination cycles with subjects,
 * centres, grading schemes, and a start date ≥7 days ahead.
 * Wired to POST /examinations via gateway examinationPlugin.
 */
import { PageHeader } from '@/components/page';
import { listInstitutions } from '@/lib/api/institutions';
import { listAcademicPeriods } from '@/lib/institutions/api';

import { NewExaminationForm } from './new-examination-form';
import { MAX_API_PAGE_SIZE } from '@/lib/api/pagination';

export const dynamic = 'force-dynamic';

export default async function NewExaminationPage() {
  const [institutions, periods] = await Promise.all([
    listInstitutions({ pageSize: MAX_API_PAGE_SIZE }),
    listAcademicPeriods().catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule examination"
        description="Define an examination with subjects, centres, grading scheme, and a start date at least seven days ahead."
      />
      <NewExaminationForm
        institutions={institutions.map((i) => ({
          id: i.id,
          name: i.name,
          code: i.code,
        }))}
        academicPeriods={periods.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
        }))}
      />
    </div>
  );
}
