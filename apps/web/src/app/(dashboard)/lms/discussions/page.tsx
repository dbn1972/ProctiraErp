/**
 * Class discussions (G-915).
 */
import { Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';

import { getDiscussion, listDiscussions } from '@/lib/api/lms';
import { EmptyState } from '@/components/page';

import { DiscussionCreateForm, DiscussionModeration } from '../_components/discussion-forms';
import { LmsSubnav } from '../_components/lms-subnav';

export const dynamic = 'force-dynamic';

export default async function LmsDiscussionsPage() {
  const listed = await listDiscussions();
  const threads = await Promise.all(
    listed.map(async (thread) => (await getDiscussion(thread.id)) ?? thread),
  );
  return (
    <section className="space-y-6" aria-labelledby="lms-discussions-heading">
      <div>
        <h1 id="lms-discussions-heading" className="text-3xl font-extrabold tracking-tight">
          Discussions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Class threads. Teachers can lock a thread or hide a post.
        </p>
      </div>
      <LmsSubnav current="/lms/discussions" />
      <Card>
        <CardHeader>
          <CardTitle>New thread</CardTitle>
        </CardHeader>
        <CardContent>
          <DiscussionCreateForm />
        </CardContent>
      </Card>
      {threads.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="No threads yet" description="Open a class discussion above." />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {threads.map((thread) => (
            <Card key={thread.id} data-testid="lms-discussion-row">
              <CardHeader>
                <CardTitle>
                  {thread.title}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    {thread.classKey}
                    {thread.locked ? ' · locked' : ''}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DiscussionModeration
                  threadId={thread.id}
                  locked={thread.locked}
                  posts={thread.posts ?? []}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
