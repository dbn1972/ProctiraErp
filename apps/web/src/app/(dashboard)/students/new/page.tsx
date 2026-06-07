/**
 * /students/new — Create a new student (Server Component) — v2.0 redesign.
 */
import Link from 'next/link';
import { ArrowLeft, Upload } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { getStudentCustomFields } from '@/lib/api/students';

import { StudentForm } from '../_components/student-form';
import type { StudentFormValues } from '@/lib/validation/student-schema';

export const dynamic = 'force-dynamic';

const EMPTY_VALUES: StudentFormValues = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  nationalId: '',
  nationality: '',
  contacts: [],
  guardians: [],
  identityDocuments: [],
  customData: {},
};

export default async function NewStudentPage() {
  const customFields = await getStudentCustomFields();

  return (
    <section aria-labelledby="new-student-heading" className="space-y-6">
      {/* Page head */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="new-student-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Add student
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture personal details, guardian information, and first enrollment.
            National ID is used for duplicate detection across the district.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/students">
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to students
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/students/import">
              <Upload className="me-1.5 h-4 w-4" aria-hidden="true" />
              Bulk import instead
            </Link>
          </Button>
        </div>
      </div>

      <StudentForm
        mode="create"
        initialValues={EMPTY_VALUES}
        customFields={customFields}
      />
    </section>
  );
}
