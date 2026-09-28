/**
 * Institution timetable generation (G-917).
 *
 * Route: /institutions/[id]/timetable/generate
 */
import Link from 'next/link';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { AcademicPeriodSelect } from '@/components/timetable/academic-period-select';
import { TimetableGenerateForm } from '@/components/timetable/generate-form';
import { formatCodeNameLabel, formatPersonLabel } from '@/lib/entity-label';
import { listAcademicPeriods, listSubjects } from '@/lib/institutions/api';
import { listStaff } from '@/lib/api/staff';
import { listBellSchedules, listGenerationJobs, listSections } from '@/lib/api/timetable';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ academicPeriod?: string }>;
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function TimetableGeneratePage(props: PageProps) {
  const params = await props.params;
  const searchParams = (await props.searchParams) ?? {};
  const institutionId = params.id;

  let academicPeriods: { id: string; label: string }[] = [];
  let academicPeriodId = '';
  try {
    const periods = await listAcademicPeriods();
    academicPeriods = periods.map((period) => ({
      id: period.id,
      label: `${period.name} (${period.status === 'active' ? 'Active' : period.status === 'inactive' ? 'Inactive' : 'Archived'})`,
    }));
    const requested = periods.find((period) => period.id === searchParams.academicPeriod);
    const active = periods.find((period) => period.status === 'active') ?? periods[0];
    academicPeriodId = (requested ?? active)?.id ?? '';
  } catch {
    academicPeriodId = '';
  }

  const [schedulesResult, sectionsResult, staffResult, jobsResult, subjects] = await Promise.all([
    listBellSchedules({ institutionId }),
    listSections({ institutionId, academicPeriodId: academicPeriodId || undefined }),
    (async () => {
      const rows: Awaited<ReturnType<typeof listStaff>>['data'] = [];
      for (let page = 1; page <= 4; page += 1) {
        const batch = await listStaff({ page, pageSize: 100 }).catch(() => ({
          data: [] as Awaited<ReturnType<typeof listStaff>>['data'],
          meta: { page, pageSize: 100, totalItems: 0, totalPages: 0 },
        }));
        rows.push(...batch.data);
        if (batch.data.length < 100) break;
      }
      return { data: rows };
    })(),
    listGenerationJobs({ institutionId }),
    listSubjects().catch(() => [] as Awaited<ReturnType<typeof listSubjects>>),
  ]);

  const schedules = schedulesResult.ok ? schedulesResult.data : [];
  const sections = sectionsResult.ok ? sectionsResult.data : [];
  const jobs = jobsResult.ok ? jobsResult.data : [];
  const sectionOptions = sections.map((s) => ({
    id: s.id,
    label: formatCodeNameLabel(s.code, s.name),
  }));
  const staffOptions = (staffResult.data ?? []).map((s) => ({
    id: s.id,
    label: formatPersonLabel(s.firstName, s.lastName, s.position),
  }));
  const subjectOptions = subjects.map((subject) => ({
    id: subject.id,
    label: formatCodeNameLabel(subject.code, subject.name),
  }));

  return (
    <div className="space-y-4" data-testid="timetable-generate-page" data-hydrated="true">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight text-foreground">Generate timetable</h2>
          <p className="text-sm text-muted-foreground">
            Places each section&apos;s weekly periods onto the bell schedule. A teacher or room that
            is already booked is left unassigned, and nothing is saved until you confirm.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href={`/institutions/${institutionId}/timetable`}>Back to grid</Link>
        </Button>
      </div>
      {academicPeriods.length > 0 ? (
        <div>
          <AcademicPeriodSelect value={academicPeriodId} options={academicPeriods} />
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-6">
          <h3 className="text-base font-semibold">Run a job</h3>
          {!academicPeriodId || schedules.length === 0 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Create an academic period and a bell schedule with periods before generating.</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="min-h-[44px]">
                  <Link href="/academic-periods">Academic periods</Link>
                </Button>
                {academicPeriodId ? (
                  <Button asChild variant="outline" size="sm" className="min-h-[44px]">
                    <Link href={`/academic-periods/${academicPeriodId}/bell-schedules`}>
                      Bell schedules
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <TimetableGenerateForm
              institutionId={institutionId}
              academicPeriodId={academicPeriodId}
              bellScheduleOptions={schedules.map((schedule) => ({
                id: schedule.id,
                label: schedule.name,
              }))}
              sectionOptions={sectionOptions}
              staffOptions={staffOptions}
              subjectOptions={subjectOptions}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="text-base font-semibold">Recent jobs</h3>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No generation jobs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm" aria-label="Generation jobs">
                <thead>
                  <tr className="border-b border-border text-start text-muted-foreground">
                    <th className="py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Run at</th>
                    <th className="px-3 py-2 font-medium">Run by</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-border/60"
                      data-testid="generation-job-row"
                    >
                      <td className="py-2 font-medium capitalize">{job.status}</td>
                      <td className="px-3 py-2">
                        {job.assignedCount} assigned · {job.clashCount} clashes
                        {job.errorMessage ? ` · ${job.errorMessage}` : ''}
                      </td>
                      <td className="px-3 py-2">{formatWhen(job.finishedAt ?? job.createdAt)}</td>
                      <td className="px-3 py-2">{job.requestedBy ?? '—'}</td>
                      <td className="py-2 text-end">
                        {job.status === 'done' ? (
                          <Link
                            href={`/institutions/${institutionId}/timetable`}
                            className="font-semibold underline"
                          >
                            View grid
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
