/**
 * /attendance — Attendance marking page (Server Component shell).
 *
 * Implements Requirement 9.1 + 9.3: per-class roster pre-populated from
 * enrollment for the selected institution / class / date.
 */
import Link from 'next/link';

import { BarChart3 } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getClassRoster, type RosterEntry } from '@/lib/api/attendance';
import { listAcademicPeriods, listInstitutions, type AcademicPeriod } from '@/lib/api/institutions';
import { listAttendancePeriods } from '@/lib/api/timetable';
import { listClassesByInstitution } from '@/lib/institutions/api';
import type { ClassSection } from '@/lib/institutions/types';

import { AttendanceMarkingForm } from './_components/attendance-marking-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readStringParam(params: Awaited<PageProps['searchParams']>, key: string): string {
  if (!params) return '';
  const value = params[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? '';
  return '';
}

export default async function AttendancePage(props: PageProps) {
  const searchParams = await props.searchParams;
  const institutionId = readStringParam(searchParams, 'institutionId');
  const classId = readStringParam(searchParams, 'classId');
  const academicPeriodId = readStringParam(searchParams, 'academicPeriodId');
  const today = new Date().toISOString().slice(0, 10);
  const date = readStringParam(searchParams, 'date') || today;

  const dayOfWeek = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // ISO 1=Mon

  const [institutions, classes, academicPeriods, roster, publishedPeriods] = await Promise.all([
    listInstitutions({ pageSize: 200 }),
    institutionId
      ? listClassesByInstitution(institutionId).catch(() => [] as ClassSection[])
      : Promise.resolve<ClassSection[]>([]),
    institutionId
      ? listAcademicPeriods(institutionId).catch(() => [] as AcademicPeriod[])
      : Promise.resolve<AcademicPeriod[]>([]),
    classId && academicPeriodId
      ? getClassRoster(classId, academicPeriodId, date)
      : Promise.resolve<RosterEntry[]>([]),
    institutionId
      ? listAttendancePeriods({ institutionId, dayOfWeek })
      : Promise.resolve({ ok: true as const, data: [] }),
  ]);

  const publishedSlots = publishedPeriods.ok === true ? publishedPeriods.data : [];

  return (
    <section aria-labelledby="attendance-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="attendance-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Mark attendance
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily attendance against the active class roster. Past 30 days editable; future dates
            are locked.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/attendance/ops">Regularisation & leave</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/attendance/reports">
              <BarChart3 className="me-1.5 h-4 w-4" aria-hidden="true" />
              View reports
            </Link>
          </Button>
        </div>
      </div>

      {institutionId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Published section meetings</CardTitle>
            <CardDescription>
              Period slots from the master schedule for this weekday (ISO day {dayOfWeek}). Use as
              the period reference when marking period-level attendance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {publishedSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No published section meetings for this day. Publish a section on the institution
                Schedule tab to surface periods here.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {publishedSlots.map((slot) => (
                  <li
                    key={slot.meetingId}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/60 pb-2 last:border-0"
                  >
                    <span className="font-medium">
                      {slot.sectionCode} · {slot.periodName}
                    </span>
                    <span className="text-muted-foreground">
                      {slot.startTime}–{slot.endTime}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      periodId={slot.periodId}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roster</CardTitle>
          <CardDescription>
            Choose institution, class, academic period, and date. The roster is pre-populated from
            active enrollments.
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
