/**
 * Applicant scholarship form, including supporting-document upload.
 * Validates: Requirement 11.2 — applications carry the scheme's required files.
 * PRC-L077: applicant and institution come from the live directories.
 */
import ScholarshipApplication from '@/features/scholarships/pages/ScholarshipApplication';
import { listInstitutions } from '@/lib/api/institutions';
import { MAX_API_PAGE_SIZE } from '@/lib/api/pagination';
import { formatCodeNameLabel } from '@/lib/entity-label';
import { loadStudentOptions } from '@/lib/load-entity-labels';

export const dynamic = 'force-dynamic';

export default async function ScholarshipApplyPage() {
  const [studentOptions, institutions] = await Promise.all([
    loadStudentOptions(),
    listInstitutions({ pageSize: MAX_API_PAGE_SIZE }).catch(() => []),
  ]);
  const institutionOptions = institutions.map((inst) => ({
    id: inst.id,
    label: formatCodeNameLabel(inst.code, inst.name),
    searchText: `${inst.code} ${inst.name}`,
  }));
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Apply for Scholarship</h1>
      <ScholarshipApplication
        applicantOptions={studentOptions}
        institutionOptions={institutionOptions}
      />
    </div>
  );
}
