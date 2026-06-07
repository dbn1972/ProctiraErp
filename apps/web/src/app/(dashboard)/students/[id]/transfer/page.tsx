/**
 * /students/[id]/transfer — Transfer workflow (Server Component shell + client form).
 *
 * Implements Requirements 6.3 / 6.4: select destination institution, capture
 * reason and effective date, and submit for approval through the workflow engine.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { listAreas, listInstitutions } from '@/lib/api/institutions';
import { getStudent, getStudentEnrollments } from '@/lib/api/students';

import { TransferForm } from './_components/transfer-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function StudentTransferPage({ params }: PageProps) {
  const studentId = params.id;
  const [student, enrollments, institutions, areas] = await Promise.all([
    getStudent(studentId),
    getStudentEnrollments(studentId),
    listInstitutions({ pageSize: 200 }),
    listAreas(),
  ]);

  if (!student) {
    notFound();
  }

  const activeEnrollments = enrollments.filter((e) => e.status === 'ENROLLED');

  return (
    <section aria-labelledby="transfer-heading" className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/students/${student.id}`}>
            <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
            Back to profile
          </Link>
        </Button>
      </div>

      <div>
        <h1 id="transfer-heading" className="text-2xl font-semibold tracking-tight">
          Transfer {student.firstName} {student.lastName}
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Select a destination institution, capture the reason, and submit for
          approval. The current enrollment will be marked transferred upon
          approval.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transfer details</CardTitle>
          <CardDescription>
            Source enrollment, destination, and effective date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeEnrollments.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              This student has no active enrollment. Enroll the student before
              initiating a transfer.
            </p>
          ) : (
            <TransferForm
              studentId={student.id}
              activeEnrollments={activeEnrollments.map((e) => ({
                id: e.id,
                institutionId: e.institutionId,
                gradeId: e.gradeId,
                academicPeriodId: e.academicPeriodId,
              }))}
              institutions={institutions.map((i) => ({
                id: i.id,
                name: i.name,
                areaId: i.areaId,
              }))}
              areas={areas.map((a) => ({
                id: a.id,
                name: a.name,
                parentId: a.parentId,
                level: a.level,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
