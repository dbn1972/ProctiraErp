/**
 * /staff/[id]/assignments/new — Create staff assignment.
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
import { listInstitutions } from '@/lib/api/institutions';
import { getStaff } from '@/lib/api/staff';
import {
  listClassesByInstitution,
  listSubjects,
  type SubjectSummary,
} from '@/lib/institutions/api';
import type { ClassSection } from '@/lib/institutions/types';

import { AssignmentForm } from '../../../_components/assignment-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function NewAssignmentPage({
  params,
  searchParams,
}: PageProps) {
  const rawInstitutionId = searchParams?.institutionId;
  const institutionId =
    typeof rawInstitutionId === 'string' ? rawInstitutionId : '';

  const [staff, institutions, subjects, classes] = await Promise.all([
    getStaff(params.id),
    listInstitutions({ pageSize: 200 }),
    listSubjects().catch(() => [] as SubjectSummary[]),
    institutionId
      ? listClassesByInstitution(institutionId).catch(
          () => [] as ClassSection[],
        )
      : Promise.resolve<ClassSection[]>([]),
  ]);
  if (!staff) {
    notFound();
  }

  return (
    <section aria-labelledby="new-assignment-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/staff/${staff.id}`}>
          <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
          Back to {staff.firstName} {staff.lastName}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle id="new-assignment-heading">New assignment</CardTitle>
          <CardDescription>
            Allocate {staff.firstName} {staff.lastName} to an institution,
            class, and subject. Total active allocation across assignments
            must not exceed 100%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AssignmentForm
            staffId={staff.id}
            institutions={institutions.map((i) => ({ id: i.id, name: i.name }))}
            subjects={subjects.map((s) => ({
              id: s.id,
              name: s.name,
              code: s.code,
            }))}
            classes={classes.map((c) => ({ id: c.id, name: c.name }))}
            defaultInstitutionId={institutionId}
          />
        </CardContent>
      </Card>
    </section>
  );
}
