/**
 * Class analytics (G-915).
 */
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

import Link from 'next/link';
import {
  getClassAnalytics,
  getQuizAnalytics,
  listAssignments,
  listAssignmentsPage,
  type QuizAnalytics,
} from '@/lib/api/lms';
import { EmptyState } from '@/components/page';

import { LmsSubnav } from '../_components/lms-subnav';

export const dynamic = 'force-dynamic';

export default async function LmsAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // PRC-M107: no hard-coded class; the class list comes from the API.
  const classKey = typeof params.classKey === 'string' ? params.classKey.trim() : '';
  const page = Math.max(1, Number(typeof params.page === 'string' ? params.page : 1) || 1);
  const QUIZ_PAGE_SIZE = 20;
  const [recent, analytics, quizPage] = await Promise.all([
    listAssignments({ pageSize: 100 }),
    classKey ? getClassAnalytics(classKey) : Promise.resolve(null),
    classKey
      ? listAssignmentsPage({ kind: 'quiz', gradeLevel: classKey, page, pageSize: QUIZ_PAGE_SIZE })
      : Promise.resolve(null),
  ]);
  const classOptions = [
    ...new Set(recent.map((a) => a.gradeLevel?.trim()).filter((g): g is string => !!g)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const quizzes = quizPage?.ok ? quizPage.items : [];
  // Stats for the current page only, fetched in parallel (bounded by page size).
  const quizStats = await Promise.all(quizzes.map((quiz) => getQuizAnalytics(quiz.id)));
  const quizRows: Array<{ quiz: (typeof quizzes)[number]; stats: QuizAnalytics }> = [];
  quizzes.forEach((quiz, index) => {
    const stats = quizStats[index];
    if (stats) quizRows.push({ quiz, stats });
  });
  const totalQuizzes = quizPage?.ok ? (quizPage.meta?.totalItems ?? quizzes.length) : 0;
  const totalPages = Math.max(1, Math.ceil(totalQuizzes / QUIZ_PAGE_SIZE));
  const pageHref = (target: number) =>
    `/lms/analytics?${new URLSearchParams({ classKey, page: String(target) }).toString()}`;
  return (
    <section className="space-y-6" aria-labelledby="lms-analytics-heading">
      <div>
        <h1
          id="lms-analytics-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Class analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {classKey
            ? `Submission rate, average score, and item difficulty for class ${classKey}.`
            : 'Choose a class to see submission rate, average score, and item difficulty.'}
        </p>
      </div>
      <LmsSubnav current="/lms/analytics" />
      <form className="flex flex-wrap gap-2" action="/lms/analytics">
        <label htmlFor="analytics-class" className="text-sm font-medium">
          Class
        </label>
        <input
          id="analytics-class"
          name="classKey"
          defaultValue={classKey}
          list="analytics-class-options"
          required
          aria-describedby="analytics-class-hint"
          className="h-11 min-h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        />
        <datalist id="analytics-class-options">
          {classOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <span id="analytics-class-hint" className="sr-only">
          Classes are the grade levels used on assignments.
        </span>
        <Button type="submit" variant="outline" className="h-11 min-h-11">
          Load
        </Button>
      </form>
      {!classKey ? (
        <EmptyState
          title="Choose a class"
          description={
            classOptions.length > 0
              ? `Pick one of ${classOptions.length} classes with coursework, then select Load.`
              : 'No assignments have a class (grade level) yet.'
          }
        />
      ) : (
        <>
          <div
            className="grid gap-4 sm:grid-cols-3"
            data-testid="lms-analytics-panel"
            data-hydrated="true"
          >
            <Card>
              <CardHeader>
                <CardTitle>Assignments</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{analytics?.assignmentCount ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Average score</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{analytics?.averageScore ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Learners</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{analytics?.uniqueStudents ?? 0}</p>
              </CardContent>
            </Card>
          </div>
          {!analytics || analytics.assignmentCount === 0 ? (
            <EmptyState
              title="No coursework for this class"
              description="Publish assignments with this class as the grade level, then come back."
            />
          ) : null}
          {quizRows.map(({ quiz, stats }) => (
            <Card key={quiz.id} data-testid="lms-quiz-analytics">
              <CardHeader>
                <CardTitle>{quiz.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  Mean {stats.mean ?? '—'} · median {stats.median ?? '—'} · {stats.submissionCount}{' '}
                  submissions
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Difficulty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.items.map((item) => (
                      <TableRow key={item.questionId} data-testid="lms-item-difficulty">
                        <TableCell>{item.prompt}</TableCell>
                        <TableCell>{item.questionType}</TableCell>
                        <TableCell>
                          {item.difficulty == null ? '—' : `${Math.round(item.difficulty * 100)}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
          {quizPage && !quizPage.ok ? (
            <p role="alert" className="text-sm text-destructive" data-testid="lms-quiz-load-error">
              Quizzes for this class could not be loaded. Try again.
            </p>
          ) : null}
          {totalPages > 1 ? (
            <nav aria-label="Quiz pages" className="flex items-center gap-3 text-sm">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="inline-flex min-h-11 items-center underline"
                >
                  Previous
                </Link>
              ) : null}
              <span aria-current="page">
                Page {page} of {totalPages} · {totalQuizzes} quizzes
              </span>
              {page < totalPages ? (
                <Link
                  href={pageHref(page + 1)}
                  className="inline-flex min-h-11 items-center underline"
                >
                  Next
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
