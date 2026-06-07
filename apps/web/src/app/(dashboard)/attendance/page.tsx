/**
 * /attendance — Attendance marking page (Server Component shell).
 *
 * Implements Requirement 9.1 + 9.3: per-class roster pre-populated from
 * enrollment for the selected institution / class / date.
 */
import Link from 'next/link';

import { ClipboardCheck } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import {
  getClassRoster,
  type RosterEntry,
} from '@/lib/api/attendance';
import {
  listAcademicPeriods,
  listInstitutions,
  type AcademicPeriod,
} from '@/lib/api/institutions';
import { listClassesByInstitution } from '@/lib/institutions/api';
import type { ClassSection } from '@/lib/institutions/types';

import { AttendanceMarkingForm } from './_components/attendance-marking-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function readStringParam(
  params: PageProps['searchParams'],
  key: string,
): string {
  if (!params) return '';
  const value = params[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? '';
  return '';
}

export default async function AttendancePage({ searchParams }: PageProps) {
  const institutionId = readStringParam(searchParams, 'institutionId');
  const classId = readStringParam(searchParams, 'classId');
  const academicPeriodId = readStringParam(searchParams, 'academicPeriodId');
  const today = new Date().toISOString().slice(0, 10);
  const date = readStringParam(searchParams, 'date') || today;

  const [institutions, classes, academicPeriods, roster] = await Promise.all([
    listInstitutions({ pageSize: 200 }),
    institutionId
      ? listClassesByInstitution(institutionId).catch(
          () => [] as ClassSection[],
        )
      : Promise.resolve<ClassSection[]>([]),
    institutionId
      ? listAcademicPeriods(institutionId).catch(() => [] as AcademicPeriod[])
      : Promise.resolve<AcademicPeriod[]>([]),
    classId && academicPeriodId
      ? getClassRoster(classId, academicPeriodId, date)
      : Promise.resolve<RosterEntry[]>([]),
  ]);

  return (
    <section aria-labelledby="attendance-heading" className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1
            id="attendance-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            <ClipboardCheck
              className="me-2 inline h-6 w-6 align-text-bottom text-[hsl(var(--primary))]"
              aria-hidden="true"
            />
            Attendance
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Mark daily attendance against the active class roster. Past 30 days
            editable; future dates are locked.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/attendance/reports">View reports</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roster</CardTitle>
          <CardDescription>
            Choose institution, class, academic period, and date. The roster is
            pre-populated from active enrollments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AttendanceMarkingForm
            institutions={institutions.map((i) => ({ id: i.id, name: i.name }))}
            classes={classes.map((c) => ({ id: c.id, name: c.name }))}
            academicPeriods={academicPeriods.map((p) => ({
              id: p.id,
              name: p.name,
              isActive: p.isActive,
            }))}
            defaults={{
              institutionId,
              classId,
              academicPeriodId,
              date,
            }}
            roster={roster}
          />
        </CardContent>
      </Card>
    </section>
  );
}
