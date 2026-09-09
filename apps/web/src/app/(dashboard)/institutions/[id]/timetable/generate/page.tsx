/**
 * Institution timetable generation (G-917).
 *
 * Route: /institutions/[id]/timetable/generate
 */
import Link from 'next/link';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { TimetableGenerateForm } from '@/components/timetable/generate-form';
import { formatCodeNameLabel, formatPersonLabel } from '@/lib/entity-label';
import { listAcademicPeriods } from '@/lib/institutions/api';
import { listStaff } from '@/lib/api/staff';
import { listBellSchedules, listGenerationJobs, listSections } from '@/lib/api/timetable';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TimetableGeneratePage(props: PageProps) {
  const params = await props.params;
  const institutionId = params.id;

  let academicPeriodId = '';
  try {
    const periods = await listAcademicPeriods();
    academicPeriodId = periods.find((p) => p.status === 'active')?.id ?? periods[0]?.id ?? '';
  } catch {
    academicPeriodId = '';
  }

  const [schedulesResult, sectionsResult, staffResult, jobsResult] = await Promise.all([
    listBellSchedules({ institutionId }),
    listSections({ institutionId, academicPeriodId: academicPeriodId || undefined }),
    listStaff({ pageSize: 100 }).catch(() => ({
      data: [],
      meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
    })),
    listGenerationJobs({ institutionId }),
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

  return (
    <div className="space-y-4" data-testid="timetable-generate-page" data-hydrated="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Generate timetable</h2>
          <p className="text-sm text-muted-foreground">
            Constraint-based greedy assignment with a repair loop. Hard clashes stay at zero;
            leftover demand is left unassigned.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/institutions/${institutionId}/timetable`}>Back to grid</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h3 className="text-base font-semibold">Run a job</h3>
          {!academicPeriodId || schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create an academic period and a bell schedule with periods before generating.
            </p>
          ) : (
            <TimetableGenerateForm
              institutionId={institutionId}
              academicPeriodId={academicPeriodId}
              bellScheduleId={schedules[0]?.id}
              sectionOptions={sectionOptions}
              staffOptions={staffOptions}
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
            <ul className="divide-y divide-border" role="list">
              {jobs.map((job) => (
                <li key={job.id} className="py-2 text-sm" data-testid="generation-job-row">
                  <span className="font-medium">{job.status}</span>
                  {' · '}
                  {job.assignedCount} assigned · {job.clashCount} clashes
                  {job.errorMessage ? ` · ${job.errorMessage}` : ''}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
