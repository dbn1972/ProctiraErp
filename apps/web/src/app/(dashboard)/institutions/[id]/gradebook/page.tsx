/**
 * Institution gradebook — section grades, workflow, rank/CGPA (G-907).
 *
 * Route: /institutions/[id]/gradebook
 */
import Link from 'next/link';

import {
  ComputeGpaForm,
  GradeEntryForm,
  ReportCardTriggerForm,
} from '@/components/gradebook/gradebook-forms';
import { GradebookSectionSwitcher } from '@/components/gradebook/section-switcher';
import { GradebookWorkflowPanel } from '@/components/gradebook/gradebook-workflow-panel';
import { Card, CardContent } from '@proctira/ui/components';
import { getSession } from '@/lib/auth/server';
import { formatCodeNameLabel, formatPersonLabel, resolveEntityLabel } from '@/lib/entity-label';
import { getStudent, listStudents, type Student } from '@/lib/api/students';
import {
  listClassRanks,
  listCreditRules,
  listCommentsBank,
  listGradeEntries,
  listGradebookSections,
  listGradingScales,
  listReportCardJobs,
} from '@/lib/api/gradebook';
import { canModerateGrades, canSubmitGrades } from '@/lib/gradebook-roles';
import {
  activeAcademicPeriods,
  pickDefaultSection,
  pickGradingBoardId,
} from '@/lib/academic-defaults';
import { listAcademicPeriods } from '@/lib/institutions/api';
import type { AcademicPeriod } from '@/lib/institutions/types';
import { getTenantToday } from '@/lib/tenant-today';
import { humanGradebookError, reportCardStatusLabel } from '@/lib/gradebook/presentation';

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

  const [
    sectionsResult,
    scalesResult,
    jobsResult,
    studentsResult,
    commentsResult,
    periods,
    today,
    creditRulesResult,
  ] = await Promise.all([
      listGradebookSections({ institutionId }),
      listGradingScales(),
      listReportCardJobs(),
      listStudents({ pageSize: 100 }),
      listCommentsBank({ institutionId }),
      listAcademicPeriods().catch(() => [] as AcademicPeriod[]),
      getTenantToday(),
      listCreditRules(),
    ]);
  const creditRuleOptions = creditRulesResult.ok
    ? creditRulesResult.data.map((rule) => ({ code: rule.code, name: rule.name }))
    : [];

  const apiError = !sectionsResult.ok
    ? sectionsResult.error
    : !scalesResult.ok
      ? scalesResult.error
      : null;

  const sections = sectionsResult.ok ? sectionsResult.data : [];
  const scales = scalesResult.ok ? scalesResult.data : [];
  const jobs = jobsResult.ok ? jobsResult.data : [];
  const comments = commentsResult.ok ? commentsResult.data : [];
  const directory = studentsResult.data ?? [];
  const studentCode = (student: Student) => {
    const custom = student.customData?.gradebookCode;
    return typeof custom === 'string' && custom.length > 0 ? custom : student.nationalId;
  };
  const toOption = (student: Student) => ({
    id: student.id,
    label: formatPersonLabel(student.firstName, student.lastName, studentCode(student)),
    searchText: `${student.firstName} ${student.lastName} ${studentCode(student) ?? ''}`,
  });
  const activePeriodIds = new Set(activeAcademicPeriods(periods, today).map((period) => period.id));
  const preferred = pickDefaultSection(sections, activePeriodIds);
  const sectionId =
    searchParams?.sectionId && sections.some((s) => s.id === searchParams.sectionId)
      ? searchParams.sectionId
      : (preferred?.id ?? '');

  const entriesResult = sectionId
    ? await listGradeEntries({ sectionId })
    : { ok: true as const, data: [] };
  const entries = entriesResult.ok ? entriesResult.data : [];
  const knownIds = new Set(directory.map((student) => student.id));
  const missingIds = [...new Set(entries.map((entry) => entry.studentId))].filter(
    (id) => !knownIds.has(id),
  );
  const extras = (
    await Promise.all(missingIds.map((id) => getStudent(id).catch(() => null)))
  ).filter((student): student is Student => student !== null);
  const studentOptions = [...directory, ...extras].map(toOption);
  const studentLabel = new Map(studentOptions.map((option) => [option.id, option.label]));
  const entryError = entriesResult.ok ? null : entriesResult.error;
  const ranksResult = sectionId ? await listClassRanks(sectionId) : { ok: true as const, data: [] };
  const ranks = ranksResult.ok ? ranksResult.data : [];

  const boardId = pickGradingBoardId(scales);
  const defaultStudentId = entries[0]?.studentId ?? studentOptions[0]?.id ?? '';
  const activeSection = sections.find((s) => s.id === sectionId);

  const institutionJobs = jobs.filter(
    (job) => !job.institutionId || job.institutionId === institutionId,
  );

  return (
    <div className="space-y-6" data-testid="institution-gradebook">
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
            <p className="text-sm font-semibold">Gradebook is unavailable</p>
            <p
              className="text-sm text-muted-foreground"
              role="alert"
              data-testid="gradebook-api-error"
            >
              {humanGradebookError(apiError, sectionsResult.ok ? undefined : sectionsResult.code)}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!apiError && sections.length === 0 ? (
        <Card>
          <CardContent
            className="space-y-3 p-6 text-sm text-muted-foreground"
            data-testid="gradebook-no-sections"
          >
            <p className="text-base font-semibold text-foreground">
              No sections for this institution yet
            </p>
            <p>Create sections on the Schedule tab before entering grades.</p>
            <Link
              href={`/institutions/${institutionId}/schedule`}
              className="inline-flex text-sm font-semibold text-primary"
            >
              Go to Schedule
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {sectionId ? (
        <>
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">Section</h3>
                  <p className="text-sm text-muted-foreground" data-testid="gradebook-section-name">
                    {activeSection
                      ? formatCodeNameLabel(activeSection.code, activeSection.name)
                      : resolveEntityLabel(sectionId, new Map(), 'Section')}
                  </p>
                </div>
                <GradebookSectionSwitcher
                  institutionId={institutionId}
                  sectionId={sectionId}
                  sections={sections}
                />
              </div>
              <GradeEntryForm
                institutionId={institutionId}
                sectionId={sectionId}
                defaultStudentId={defaultStudentId}
                studentOptions={studentOptions}
                comments={comments}
                creditRuleOptions={creditRuleOptions}
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
                  No grading scale is available yet. Ask an administrator to add a board scale
                  before generating report cards.
                </p>
              )}
              {institutionJobs.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm" data-testid="report-card-jobs">
                  {institutionJobs.slice(0, 8).map((job) => {
                    const studentId =
                      typeof job.metadata?.studentId === 'string' ? job.metadata.studentId : '';
                    const studentName = studentId
                      ? resolveEntityLabel(studentId, studentLabel, 'Student')
                      : 'Student';
                    const term =
                      typeof job.metadata?.term === 'string' ? job.metadata.term : 'Term';
                    const label = reportCardStatusLabel(job.status);
                    return (
                      <li key={job.id} className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                          {label}
                        </span>
                        <span>
                          Report card · {studentName} · {term}
                        </span>
                        {job.status === 'FAILED' && job.errorMessage ? (
                          <span className="text-xs text-muted-foreground">
                            · {job.errorMessage}
                          </span>
                        ) : null}
                        {job.status === 'SUCCEEDED' ? (
                          <Link
                            href={`/institutions/${institutionId}/gradebook/report-cards/${job.id}`}
                            className="text-sm font-semibold text-primary"
                            data-testid={`report-card-link-${job.id}`}
                          >
                            PDF
                          </Link>
                        ) : null}
                        {job.status === 'FAILED' ? (
                          <Link
                            href={`/institutions/${institutionId}/gradebook?sectionId=${sectionId}#gradebook-entries`}
                            className="text-sm font-semibold text-primary"
                          >
                            Review grades
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
