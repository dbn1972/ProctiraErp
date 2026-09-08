/**
 * Institution gradebook — section grades, GPA, report-card trigger (WS3).
 *
 * Route: /institutions/[id]/gradebook
 */
import {
  ComputeGpaForm,
  GradeEntryForm,
  ReportCardTriggerForm,
} from '@/components/gradebook/gradebook-forms';
import { Card, CardContent } from '@proctira/ui/components';
import { formatCodeNameLabel, formatPersonLabel, resolveEntityLabel } from '@/lib/entity-label';
import { listStudents } from '@/lib/api/students';
import {
  listGradeEntries,
  listGradebookSections,
  listGradingScales,
  listReportCardJobs,
} from '@/lib/api/gradebook';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
  searchParams?: { sectionId?: string };
}

export default async function InstitutionGradebookPage({ params, searchParams }: PageProps) {
  const institutionId = params.id;

  const [sectionsResult, scalesResult, jobsResult, studentsResult] = await Promise.all([
    listGradebookSections({ institutionId }),
    listGradingScales(),
    listReportCardJobs(),
    listStudents({ pageSize: 100 }),
  ]);

  const apiError = !sectionsResult.ok
    ? sectionsResult.error
    : !scalesResult.ok
      ? scalesResult.error
      : null;

  const sections = sectionsResult.ok ? sectionsResult.data : [];
  const scales = scalesResult.ok ? scalesResult.data : [];
  const jobs = jobsResult.ok ? jobsResult.data : [];
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

  const boardId = scales.find((s) => s.isDefault)?.boardId ?? scales[0]?.boardId ?? '';
  const defaultStudentId = entries[0]?.studentId ?? studentOptions[0]?.id ?? '';
  const activeSection = sections.find((s) => s.id === sectionId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">Gradebook</h2>
        <p className="text-sm text-muted-foreground">
          Enter section grades, compute GPA snapshots, and queue term report cards. Board scales
          drive letter bands.
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
                <p className="text-sm text-muted-foreground">
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
              ) : null}
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No grades entered for this section.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Student</th>
                        <th className="py-2 pr-3 font-medium">Assessment</th>
                        <th className="py-2 pr-3 font-medium">Score</th>
                        <th className="py-2 pr-3 font-medium">Letter</th>
                        <th className="py-2 pr-3 font-medium">Workflow</th>
                        <th className="py-2 font-medium">Entered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((row) => (
                        <tr key={row.id} className="border-b border-border/60">
                          <td className="py-2 pr-3 text-sm">
                            {resolveEntityLabel(row.studentId, studentLabel, 'Student')}
                          </td>
                          <td className="py-2 pr-3">{row.assessmentCode ?? '—'}</td>
                          <td className="py-2 pr-3 tabular-nums">{row.numericScore ?? '—'}</td>
                          <td className="py-2 pr-3">{row.letterGrade ?? '—'}</td>
                          <td className="py-2 pr-3 text-xs">
                            {row.lockedAt
                              ? 'LOCKED'
                              : String(
                                  (row.metadata as { workflowStatus?: string } | undefined)
                                    ?.workflowStatus ?? 'DRAFT',
                                )}
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {new Date(row.enteredAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
