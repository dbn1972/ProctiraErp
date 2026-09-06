/**
 * Bell schedules for an academic period — Academics redesign (WS1).
 *
 * Route: /academic-periods/[id]/bell-schedules
 */
import Link from 'next/link';
import { ArrowLeft, Bell } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import {
  BellScheduleCreateForm,
  PeriodCreateForm,
} from '@/components/timetable/bell-schedule-forms';
import { listInstitutions } from '@/lib/api/institutions';
import { ApiClientError, listAcademicPeriods } from '@/lib/institutions/api';
import { listBellSchedules, listPeriods } from '@/lib/api/timetable';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function BellSchedulesPage({ params }: PageProps) {
  const academicPeriodId = params.id;

  let periodName = academicPeriodId;
  try {
    const periods = await listAcademicPeriods();
    periodName = periods.find((p) => p.id === academicPeriodId)?.name ?? academicPeriodId;
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
  }

  const institutions = await listInstitutions({ pageSize: 50 });
  const defaultInstitutionId = institutions[0]?.id ?? '';

  const schedulesResult = await listBellSchedules({ academicPeriodId });
  const apiError = schedulesResult.ok ? null : schedulesResult.error;
  const schedules = schedulesResult.ok ? schedulesResult.data : [];

  const schedulesWithPeriods = await Promise.all(
    schedules.map(async (schedule) => {
      const periods = await listPeriods(schedule.id);
      return {
        schedule,
        periods: periods.ok ? periods.data : [],
        periodsError: periods.ok ? null : periods.error,
      };
    }),
  );

  return (
    <section aria-labelledby="bell-schedules-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/academic-periods">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to academic periods
        </Link>
      </Button>

      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
        >
          <Bell className="h-6 w-6" />
        </span>
        <div>
          <h1
            id="bell-schedules-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Bell schedules
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Period start/end times for {periodName}. Day pattern drives the institution
            timetable grid.
          </p>
        </div>
      </div>

      {apiError ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-sm font-semibold text-foreground">Timetable API unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {apiError}
              {!schedulesResult.ok &&
                schedulesResult.code === 'TIMETABLE_SCHEMA_MISSING' &&
                ' — apply db/sql/003_sis_timetable_schedule_schema.sql on Postgres.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-lg font-bold tracking-tight">Create bell schedule</h2>
              {!defaultInstitutionId ? (
                <p className="text-sm text-muted-foreground">
                  Register an institution before creating a bell schedule.
                </p>
              ) : (
                <BellScheduleCreateForm
                  academicPeriodId={academicPeriodId}
                  institutionId={defaultInstitutionId}
                />
              )}
            </CardContent>
          </Card>

          {schedulesWithPeriods.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No bell schedules for this academic period yet.
              </CardContent>
            </Card>
          ) : (
            schedulesWithPeriods.map(({ schedule, periods, periodsError }) => (
              <Card key={schedule.id}>
                <CardContent className="space-y-4 p-6">
                  <div>
                    <h2 className="text-lg font-bold tracking-tight">{schedule.name}</h2>
                    <p className="text-xs font-mono text-muted-foreground">
                      {schedule.dayPattern} · {schedule.status}
                    </p>
                  </div>

                  {periodsError ? (
                    <p className="text-sm text-muted-foreground">{periodsError}</p>
                  ) : periods.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No periods yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">Order</th>
                            <th className="py-2 pr-3 font-medium">Name</th>
                            <th className="py-2 pr-3 font-medium">Start</th>
                            <th className="py-2 font-medium">End</th>
                          </tr>
                        </thead>
                        <tbody>
                          {periods.map((p) => (
                            <tr key={p.id} className="border-b border-border/60">
                              <td className="py-2 pr-3 tabular-nums">{p.periodOrder}</td>
                              <td className="py-2 pr-3 font-medium">{p.name}</td>
                              <td className="py-2 pr-3 font-mono text-xs">{p.startTime}</td>
                              <td className="py-2 font-mono text-xs">{p.endTime}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <PeriodCreateForm
                    bellScheduleId={schedule.id}
                    academicPeriodId={academicPeriodId}
                    nextOrder={(periods[periods.length - 1]?.periodOrder ?? 0) + 1}
                  />
                </CardContent>
              </Card>
            ))
          )}
        </>
      )}
    </section>
  );
}
