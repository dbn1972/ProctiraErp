/**
 * /students/[id]/edit — Edit an existing student (Server Component).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import {
  Button,
} from '@proctira/ui/components';
import { getStudent, getStudentCustomFields } from '@/lib/api/students';

import { StudentForm } from '../../_components/student-form';
import type { StudentFormValues } from '@/lib/validation/student-schema';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function EditStudentPage({ params }: PageProps) {
  const [student, customFields] = await Promise.all([
    getStudent(params.id),
    getStudentCustomFields(),
  ]);

  if (!student) {
    notFound();
  }

  const initialValues: StudentFormValues = {
    firstName: student.firstName,
    lastName: student.lastName,
    dateOfBirth: student.dateOfBirth,
    gender: student.gender,
    nationalId: student.nationalId ?? '',
    nationality: student.nationality ?? '',
    contacts: (student.contacts ?? []).map((c) => ({
      type: c.type,
      value: c.value,
      isPrimary: c.isPrimary ?? false,
    })),
    guardians: (student.guardians ?? []).map((g) => ({
      ...(g.id ? { id: g.id } : {}),
      firstName: g.firstName,
      lastName: g.lastName,
      relationship: g.relationship,
      contactPhone: g.contactPhone ?? '',
      contactEmail: g.contactEmail ?? '',
    })),
    identityDocuments: (student.identityDocuments ?? []).map((doc) => ({
      type: doc.type,
      number: doc.number,
      issuingCountry: doc.issuingCountry ?? '',
      expiryDate: doc.expiryDate ?? '',
    })),
    customData: student.customData ?? {},
  };

  return (
    <section aria-labelledby="edit-student-heading" className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/students/${student.id}`}>
            <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
            Back to profile
          </Link>
        </Button>
      </div>
      <div>
        <h1 id="edit-student-heading" className="text-2xl font-semibold tracking-tight">
          Edit {student.firstName} {student.lastName}
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          All changes are recorded in the audit trail.
        </p>
      </div>
      <StudentForm
        mode="edit"
        studentId={student.id}
        initialValues={initialValues}
        customFields={customFields}
      />
    </section>
  );
}
