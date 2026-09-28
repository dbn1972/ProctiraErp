/**
 * Applicant scholarship form, including supporting-document upload.
 * Validates: Requirement 11.2 — applications carry the scheme's required files.
 */
import ScholarshipApplication from '@/features/scholarships/pages/ScholarshipApplication';

export default function ScholarshipApplyPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Apply for Scholarship</h1>
      <ScholarshipApplication />
    </div>
  );
}
