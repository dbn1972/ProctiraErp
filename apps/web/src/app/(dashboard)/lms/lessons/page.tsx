/**
 * Lessons / content library (G-915). Students see published lessons only.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';

import { listLessons } from '@/lib/api/lms';
import { EmptyState } from '@/components/page';

import { LmsSubnav } from '../_components/lms-subnav';
import { LessonForm } from '../_components/lesson-form';

export const dynamic = 'force-dynamic';

export default async function LmsLessonsPage() {
  const items = await listLessons();
  return (
    <section className="space-y-6" aria-labelledby="lms-lessons-heading">
      <div>
        <h1 id="lms-lessons-heading" className="text-3xl font-extrabold tracking-tight">
          Lessons
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lesson library with link, file, or embedded video resources. Students see published lessons
          only.
        </p>
      </div>
      <LmsSubnav current="/lms/lessons" />
      <Card>
        <CardHeader>
          <CardTitle>New lesson</CardTitle>
        </CardHeader>
        <CardContent>
          <LessonForm />
        </CardContent>
      </Card>
      {items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="No lessons yet" description="Publish a lesson above." />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border p-4" data-testid="lms-lesson-row">
              <p className="font-semibold">{item.title}</p>
              <p className="text-xs text-muted-foreground">
                {item.published ? 'published' : 'draft'}
                {item.subject ? ` · ${item.subject}` : ''}
              </p>
              {item.description ? <p className="mt-2 text-sm">{item.description}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
