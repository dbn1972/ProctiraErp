/**
 * Rubrics (G-915).
 */
import { Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';

import { listRubrics } from '@/lib/api/lms';
import { EmptyState } from '@/components/page';

import { LmsSubnav } from '../_components/lms-subnav';
import { RubricForm } from '../_components/rubric-form';

export const dynamic = 'force-dynamic';

export default async function LmsRubricsPage() {
  const items = await listRubrics();
  return (
    <section className="space-y-6" aria-labelledby="lms-rubrics-heading">
      <div>
        <h1 id="lms-rubrics-heading" className="text-3xl font-extrabold tracking-tight">
          Rubrics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Criteria × levels. Attach to assignments and essay bank items, then grade submissions.
        </p>
      </div>
      <LmsSubnav current="/lms/rubrics" />
      <Card>
        <CardHeader>
          <CardTitle>New rubric</CardTitle>
        </CardHeader>
        <CardContent>
          <RubricForm />
        </CardContent>
      </Card>
      {items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="No rubrics yet" description="Create a rubric to grade essays." />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border p-4" data-testid="lms-rubric-row">
              <p className="font-semibold">{item.name}</p>
              <p className="text-xs text-muted-foreground">{item.subject ?? 'Any subject'}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
