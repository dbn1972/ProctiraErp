/**
 * Class analytics (G-915).
 */
import { Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';

import { getClassAnalytics } from '@/lib/api/lms';
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

  return (
    <section className="space-y-6" aria-labelledby="lms-analytics-heading">
      <div>
        <h1 id="lms-analytics-heading" className="text-3xl font-extrabold tracking-tight">
          Class analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submission rate, average score, and mastery by skill for class {classKey}.
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
      {!analytics || analytics.assignmentCount === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="No coursework for this class"
              description="Publish assignments with this class as the grade level, then come back."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3" data-testid="lms-analytics-panel" data-hydrated="true">
          <Card>
            <CardHeader>
              <CardTitle>Submission rate</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.submissionRate}</p>
              <p className="text-xs text-muted-foreground">
                {analytics.submissionCount} submissions / {analytics.assignmentCount} assignments
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Average score</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.averageScore}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Learners</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.uniqueStudents}</p>
            </CardContent>
          </Card>
          <Card className="sm:col-span-3">
            <CardHeader>
              <CardTitle>Mastery by skill / tag</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.masteryBySkill.length === 0 ? (
                <p className="text-sm text-muted-foreground">No quiz attempts tagged yet.</p>
              ) : (
                <ul className="space-y-1">
                  {analytics.masteryBySkill.map((row) => (
                    <li key={row.skillId} data-testid="lms-mastery-row">
                      {row.label}: {Math.round(row.averageMastery * 100)}% ({row.attempts} attempts)
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
