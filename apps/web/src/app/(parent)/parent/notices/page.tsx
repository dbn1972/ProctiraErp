import { requireSession } from '@/lib/auth/server';
import { getChildNotices, listChildren } from '@/lib/api/parent-portal';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

export default async function ParentNoticesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const params = await searchParams;
  const children = await listChildren();
  const child = pickChild(children, firstSearchParam(params.studentId));

  if (!child) {
    return (
      <AcademicFrame
        title="Notices"
        description="School announcements for your family."
        testId="parent-notices"
        status="empty-children"
        emptyMessage="No notices to show."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const result = await getChildNotices(child.studentId);
  const notices = result.payload?.data ?? [];
  const status = !result.ok
    ? result.status === 403 || result.status === 404
      ? 'forbidden'
      : 'error'
    : 'ok';

  return (
    <AcademicFrame
      title="Notices"
      description="School announcements for your family."
      testId="parent-notices"
      childrenLinks={children}
      selectedId={child.studentId}
      status={status}
      errorMessage={result.message}
      emptyMessage="There are no school notices right now."
      hasRows={notices.length > 0}
    >
      <ul className="divide-y divide-border" role="list">
        {notices.map((notice) => (
          <li key={notice.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">{notice.title}</p>
            {notice.body ? (
              <p className="mt-1 text-sm text-muted-foreground">{notice.body}</p>
            ) : null}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {notice.channel ?? 'notice'}
              {notice.sentAt ? ` · ${new Date(notice.sentAt).toLocaleDateString()}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
