/**
 * Institution gradebook — section grades, workflow, rank/CGPA (G-907).
 *
 * Route: /institutions/[id]/gradebook
 */
import {
  ComputeGpaForm,
  GradeEntryForm,
  ReportCardTriggerForm,
} from '@/components/gradebook/gradebook-forms';
import { GradebookWorkflowPanel } from '@/components/gradebook/gradebook-workflow-panel';
import { Card, CardContent } from '@proctira/ui/components';
import { getSession } from '@/lib/auth/server';
import { formatCodeNameLabel, formatPersonLabel, resolveEntityLabel } from '@/lib/entity-label';
import { listStudents } from '@/lib/api/students';
import {
  listClassRanks,
  listCommentsBank,
  listGradeEntries,
  listGradebookSections,
  listGradingScales,
  listReportCardJobs,
} from '@/lib/api/gradebook';
import { canModerateGrades, canSubmitGrades } from '@/lib/gradebook-roles';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ sectionId?: string }>;
}

export default async function InstitutionGradebookPage(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const institutionId = params.id;
  const session = await getSession();
  const roles = session?.user.roles ?? [];
  const canSubmit = canSubmitGrades(roles);
  const canModerate = canModerateGrades(roles);

  const [sectionsResult, scalesResult, jobsResult, studentsResult, commentsResult] =
    await Promise.all([
      listGradebookSections({ institutionId }),
      listGradingScales(),
      listReportCardJobs(),
      listStudents({ pageSize: 100 }),
      listCommentsBank({ institutionId }),
    ]);

  const apiError = !sectionsResult.ok
    ? sectionsResult.error
    : !scalesResult.ok
      ? scalesResult.error
      : null;

  const sections = sectionsResult.ok ? sectionsResult.data : [];
  const scales = scalesResult.ok ? scalesResult.data : [];
  const jobs = jobsResult.ok ? jobsResult.data : [];
  const comments = commentsResult.ok ? commentsResult.data : [];
  const studentOptions = (studentsResult.data ?? []).map((s) => ({
    id: s.id,
    label: formatPersonLabel(s.firstName, s.lastName, s.nationalId),
    searchText: `${s.firstName} ${s.lastName} ${s.nationalId ?? ''}`,
  }));
  const studentLabel = new Map(studentOptions.map((s) => [s.id, s.label]));

  const sectionId =
    searchParams?.sectionId && sections.some((s) => s.id === searchParams.sectionId)
      ? searchParams.sectionId
      : (sections[0]?.id ?? '');

  const entriesResult = sectionId
    ? await listGradeEntries({ sectionId })
    : { ok: true as const, data: [] };
  const entries = entriesResult.ok ? entriesResult.data : [];
  const entryError = entriesResult.ok ? null : entriesResult.error;
  const ranksResult = sectionId
    ? await listClassRanks(sectionId)
    : { ok: true as const, data: [] };
  const ranks = ranksResult.ok ? ranksResult.data : [];

  const boardId = scales.find((s) => s.isDefault)?.boardId ?? scales[0]?.boardId ?? '';
  const defaultStudentId = entries[0]?.studentId ?? studentOptions[0]?.id ?? '';
  const activeSection = sections.find((s) => s.id === sectionId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">Gradebook</h2>
        <p className="text-sm text-muted-foreground">
          Enter section grades, submit through approve / lock / publish, compute class rank and
          CGPA, and queue term report cards. Board scales drive letter bands.
        </p>
      </div>

      {apiError ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-sm font-semibold">Gradebook API unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {apiError}
              {sectionsResult.ok === false &&
                sectionsResult.code === 'GRADEBOOK_SCHEMA_MISSING' &&
                ' — apply db/sql/003_sis_timetable_schedule_schema.sql on Postgres.'}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!apiError && sections.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No sections for this institution yet. Seed with{' '}
            <code className="text-xs">db/seeds/004_sis_gradebook_credit_section.sql</code> or create
            sections from master schedule (WS2).
          </CardContent>
        </Card>
      ) : null}

      {sectionId ? (
        <>
          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <h3 className="text-base font-semibold">Section</h3>
                <p className="text-sm text-muted-foreground" data-testid="gradebook-section-name">
                  {activeSection
                    ? formatCodeNameLabel(activeSection.code, activeSection.name)
                    : resolveEntityLabel(sectionId, new Map(), 'Section')}
                </p>
              </div>
              <GradeEntryForm
                institutionId={institutionId}
                sectionId={sectionId}
                defaultStudentId={defaultStudentId}
                studentOptions={studentOptions}
                comments={comments}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6">
              <h3 className="text-base font-semibold">Entries</h3>
              {entryError ? (
                <p className="text-sm text-destructive" role="alert">
                  {entryError}
                </p>
              ) : (
                <GradebookWorkflowPanel
                  institutionId={institutionId}
                  sectionId={sectionId}
                  academicPeriodId={activeSection?.academicPeriodId}
                  boardId={boardId || undefined}
                  entries={entries}
                  ranks={ranks}
                  comments={comments}
                  studentLabel={studentLabel}
                  canSubmit={canSubmit}
                  canModerate={canModerate}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-6">
              <h3 className="text-base font-semibold">GPA</h3>
              <ComputeGpaForm
                institutionId={institutionId}
                defaultStudentId={defaultStudentId}
                boardId={boardId || undefined}
                studentOptions={studentOptions}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-6">
              <h3 className="text-base font-semibold">Report card</h3>
              {boardId ? (
                <ReportCardTriggerForm
                  institutionId={institutionId}
                  defaultStudentId={defaultStudentId}
                  boardId={boardId}
                  studentOptions={studentOptions}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No grading scale / board available — seed board scales first.
                </p>
              )}
              {jobs.length > 0 ? (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {jobs.slice(0, 5).map((job) => (
                    <li key={job.id}>
                      Job {job.id.slice(0, 8)} · {job.status}
                      {job.artifactUri ? ` · ${job.artifactUri}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
