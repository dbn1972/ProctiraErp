/**
 * /students/[id]/enroll — Place a student into an institution / grade / period.
 *
 * Complements `/students/new` (demographics) with the enrollment write path
 * against POST /api/v1/enrollments (Requirement 6.2).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRightLeft, GraduationCap } from 'lucide-react';

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

import { EnrollForm } from './_components/enroll-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StudentEnrollPage(props: PageProps) {
  const params = await props.params;
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
  const displayName = `${student.firstName} ${student.lastName}`.trim();

  return (
    <section
      aria-labelledby="enroll-heading"
      className="space-y-6"
      data-testid="student-enroll-page"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="enroll-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Enroll student
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {displayName} · Choose institution, grade, and academic period for the first placement.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/students/${student.id}`}>
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to profile
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enrollment details</CardTitle>
            <CardDescription>
              Creates an ENROLLED record via the student enrollment service.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeEnrollments.length > 0 ? (
              <div className="space-y-4" data-testid="enroll-already-active" role="status">
                <p className="text-sm text-muted-foreground">
                  This student already has an active enrollment. Use transfer to move schools, or
                  graduate when they complete the programme.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href={`/students/${student.id}/transfer`}>
                      <ArrowRightLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
                      Request transfer
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/students/${student.id}`}>View profile</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <EnrollForm
                studentId={student.id}
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Progression path</CardTitle>
            <CardDescription className="text-xs">
              Enrol → transfer / graduate from the student profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pb-5 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <GraduationCap
                className="mt-0.5 h-4 w-4 shrink-0 text-foreground"
                aria-hidden="true"
              />
              <p>
                New demographics start at{' '}
                <Link
                  href="/students/new"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  Add student
                </Link>
                , then return here to place them.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
