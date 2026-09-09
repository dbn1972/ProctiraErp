/**
 * Class analytics (G-915).
 */
import {
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

import { getClassAnalytics, getQuizAnalytics, listAssignments, type QuizAnalytics } from '@/lib/api/lms';
import { EmptyState } from '@/components/page';

import { LmsSubnav } from '../_components/lms-subnav';

export const dynamic = 'force-dynamic';

export default async function LmsAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const classKey = typeof params.classKey === 'string' ? params.classKey : '7A';
  const analytics = await getClassAnalytics(classKey);
  const quizzes = (await listAssignments({ kind: 'quiz', pageSize: 50 })).filter(
    (a) => a.gradeLevel === classKey,
  );
  const quizRows: Array<{ quiz: (typeof quizzes)[number]; stats: QuizAnalytics }> = [];
  for (const quiz of quizzes) {
    const stats = await getQuizAnalytics(quiz.id);
    if (stats) quizRows.push({ quiz, stats });
  }

  return (
    <section className="space-y-6" aria-labelledby="lms-analytics-heading">
      <div>
        <h1 id="lms-analytics-heading" className="text-3xl font-extrabold tracking-tight">
          Class analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submission rate, average score, and item difficulty for class {classKey}.
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
          className="h-11 rounded-md border px-3"
        />
        <button type="submit" className="h-11 rounded-md border px-4 text-sm font-medium">
          Load
        </button>
      </form>
      <div className="grid gap-4 sm:grid-cols-3" data-testid="lms-analytics-panel" data-hydrated="true">
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
    </section>
  );
}
