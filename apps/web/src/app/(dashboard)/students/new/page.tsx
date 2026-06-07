/**
 * /students/new — Create a new student (Server Component).
 */
import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import {
  Button,
} from '@proctira/ui/components';
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
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/students">
            <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
            Back to students
          </Link>
        </Button>
      </div>
      <div>
        <h1 id="new-student-heading" className="text-2xl font-semibold tracking-tight">
          Add student
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Enter personal details, guardians, and identity documents.
        </p>
      </div>
      <StudentForm
        mode="create"
        initialValues={EMPTY_VALUES}
        customFields={customFields}
      />
    </section>
  );
}
