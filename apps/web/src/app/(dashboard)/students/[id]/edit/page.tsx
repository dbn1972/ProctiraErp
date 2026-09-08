/**
 * /students/[id]/edit — Edit an existing student (Server Component) — v2.0 redesign.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { getStudent, getStudentCustomFields } from '@/lib/api/students';

import { StudentForm } from '../../_components/student-form';
import type { StudentFormValues } from '@/lib/validation/student-schema';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditStudentPage(props: PageProps) {
  const params = await props.params;
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

  const cd = student.customData ?? {};
  const gradeSection = typeof cd['gradeSection'] === 'string' ? cd['gradeSection'] : '';
  const institutionName = typeof cd['institutionName'] === 'string' ? cd['institutionName'] : '';
  const admNo = typeof cd['admissionNo'] === 'string' ? cd['admissionNo'] : '';
  const contextParts = [admNo && `Adm. ${admNo}`, gradeSection, institutionName].filter(Boolean);

  return (
    <section aria-labelledby="edit-student-heading" className="space-y-6">
      {/* Page head */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="edit-student-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Edit student: {student.firstName} {student.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {contextParts.length > 0 ? `${contextParts.join(' · ')} · ` : ''}
            All changes are recorded in the audit trail with your name and timestamp.
          </p>
        </div>
        <div className="shrink-0">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/students/${student.id}`}>
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to profile
            </Link>
          </Button>
        </div>
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
