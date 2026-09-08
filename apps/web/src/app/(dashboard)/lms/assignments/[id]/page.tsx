/**
 * Assignment / homework / quiz detail (Server Component).
 * FR-UX-004 — lifecycle actions, quiz questions, submissions with inline grading.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, CalendarClock, Clock3, Target } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { getAssignment, listSubmissions, type LmsSubmission } from '@/lib/api/lms';
import { isUuidLike } from '@/lib/entity-label';

import { KindPill, ScopePill, StatusPill, SubmissionPill } from '../../_components/badges';
import { AssignmentLifecycle } from '../../_components/assignment-lifecycle';
import { GradeSubmissionForm } from '../../_components/grade-submission-form';

export const dynamic = 'force-dynamic';

const KIND_KEYS = {
  assignment: 'kindAssignment',
  homework: 'kindHomework',
  quiz: 'kindQuiz',
} as const;
const STATUS_KEYS = {
  draft: 'statusDraft',
  published: 'statusPublished',
  closed: 'statusClosed',
  archived: 'statusArchived',
} as const;
const SUBMISSION_KEYS = {
  submitted: 'subSubmitted',
  late: 'subLate',
  graded: 'subGraded',
  returned: 'subReturned',
} as const;

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuidLike(id)) notFound();

  const [t, assignment] = await Promise.all([getTranslations('lms'), getAssignment(id)]);
  if (!assignment) notFound();

  // Learners get 403 on the roster; treat as "no roster" rather than an error.
  const submissions: LmsSubmission[] = await listSubmissions(id).catch(() => []);
  const graded = submissions.filter((s) => s.status === 'graded' || s.status === 'returned');
  const average =
    graded.length > 0 ? graded.reduce((sum, s) => sum + (s.score ?? 0), 0) / graded.length : null;

  return (
    <section aria-labelledby="lms-detail-heading" className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ms-2 mb-2">
          <Link href="/lms">
            <ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t('backToHub')}
          </Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <KindPill kind={assignment.kind} label={t(KIND_KEYS[assignment.kind])} />
              <ScopePill
                scope={assignment.scope}
                label={assignment.scope === 'board' ? t('scopeBoard') : t('scopeSchool')}
              />
              <StatusPill status={assignment.status} label={t(STATUS_KEYS[assignment.status])} />
            </div>
            <h1
              id="lms-detail-heading"
              className="text-3xl font-extrabold tracking-tight text-foreground"
            >
              {assignment.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {assignment.subject}
              {assignment.gradeLevel ? ` · ${t('grade', { grade: assignment.gradeLevel })}` : ''}
            </p>
          </div>
          <AssignmentLifecycle id={assignment.id} status={assignment.status} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <CalendarClock className="h-5 w-5 text-amber-600" aria-hidden="true" />
            <div>
              <p className="text-xs text-muted-foreground">{t('colDue')}</p>
              <p className="font-semibold tabular-nums">{fmt(assignment.dueAt)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Target className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <div>
              <p className="text-xs text-muted-foreground">{t('colMaxScore')}</p>
              <p className="font-semibold tabular-nums">{assignment.maxScore.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Clock3 className="h-5 w-5 text-fuchsia-600" aria-hidden="true" />
            <div>
              <p className="text-xs text-muted-foreground">
                {assignment.kind === 'quiz' ? t('fieldTimeLimit') : t('fieldAllowLate')}
              </p>
              <p className="font-semibold tabular-nums">
                {assignment.kind === 'quiz'
                  ? assignment.timeLimitMinutes
                    ? t('minutes', { count: assignment.timeLimitMinutes })
                    : t('noLimit')
                  : assignment.allowLate
                    ? t('yes')
                    : t('no')}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {assignment.description ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('fieldDescription')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{assignment.description}</p>
          </CardContent>
        </Card>
      ) : null}

      {assignment.kind === 'quiz' && assignment.questions && assignment.questions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('sectionQuestions', { count: assignment.questions.length })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {assignment.questions.map((q, i) => (
                <li key={q.id} className="rounded-lg border p-4" data-testid="quiz-question">
                  <p className="font-medium">
                    <span className="me-2 text-muted-foreground">{i + 1}.</span>
                    {q.prompt}
                    <span className="ms-2 text-xs text-muted-foreground">
                      ({t('pointsShort', { count: q.points })})
                    </span>
                  </p>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {q.options.map((opt, oi) => (
                      <li
                        key={oi}
                        className={
                          oi === q.correctOptionIndex
                            ? 'rounded-md bg-emerald-50 px-2 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'rounded-md px-2 py-1 text-sm'
                        }
                      >
                        {opt}
                        {oi === q.correctOptionIndex ? (
                          <span className="sr-only"> ({t('correctAnswer')})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {q.explanation ? (
                    <p className="mt-2 text-xs text-muted-foreground">{q.explanation}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">
            {t('sectionSubmissions', { count: submissions.length })}
          </CardTitle>
          {average !== null ? (
            <p className="text-sm text-muted-foreground">
              {t('averageScore', { score: average.toFixed(1), max: assignment.maxScore })}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {submissions.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t('noSubmissions')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label={t('sectionSubmissions', { count: submissions.length })}>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="ps-4 font-semibold">{t('colStudent')}</TableHead>
                    <TableHead className="font-semibold">{t('colSubmittedAt')}</TableHead>
                    <TableHead className="font-semibold">{t('colStatus')}</TableHead>
                    <TableHead className="text-end font-semibold">{t('colScore')}</TableHead>
                    <TableHead className="pe-4 font-semibold">{t('colGrade')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((s) => (
                    <TableRow key={s.id} data-testid="submission-row">
                      <TableCell className="ps-4 font-mono text-xs">{s.studentId}</TableCell>
                      <TableCell className="text-sm tabular-nums">{fmt(s.submittedAt)}</TableCell>
                      <TableCell>
                        <SubmissionPill status={s.status} label={t(SUBMISSION_KEYS[s.status])} />
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {s.score !== null ? `${s.score} / ${assignment.maxScore}` : '—'}
                        {s.autoGraded ? (
                          <span className="ms-1 text-[11px] text-muted-foreground">
                            {t('auto')}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="pe-4">
                        <GradeSubmissionForm
                          assignmentId={assignment.id}
                          submissionId={s.id}
                          maxScore={assignment.maxScore}
                          initialScore={s.score}
                          initialFeedback={s.feedback}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
