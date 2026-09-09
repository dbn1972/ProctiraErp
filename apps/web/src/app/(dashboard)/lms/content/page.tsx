/**
 * Content library (G-915). Students see published items only.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';

import { listContentItems } from '@/lib/api/lms';
import { EmptyState } from '@/components/page';

import { ContentForm } from '../_components/content-form';
import { LmsSubnav } from '../_components/lms-subnav';

export const dynamic = 'force-dynamic';

export default async function LmsContentPage() {
  const items = await listContentItems();
  return (
    <section className="space-y-6" aria-labelledby="lms-content-heading">
      <div>
        <h1
          id="lms-content-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Content library
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lesson resources as text, link or file. Students only see published items.
        </p>
      </div>
      <LmsSubnav current="/lms/content" />
      <Card>
        <CardHeader>
          <CardTitle>New resource</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentForm />
        </CardContent>
      </Card>
      {items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="No content yet" description="Publish a lesson resource above." />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border p-4" data-testid="lms-content-row">
              <p className="font-semibold">{item.title}</p>
              <p className="text-xs text-muted-foreground">
                {item.kind}
                {item.published ? ' · published' : ' · draft'}
                {item.classKey ? ` · ${item.classKey}` : ''}
              </p>
              {item.body ? <p className="mt-2 text-sm">{item.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
