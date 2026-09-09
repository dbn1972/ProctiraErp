import { getSelfNotices } from '@/lib/api/parent-portal';
import { AcademicFrame } from '../../../(parent)/parent/_components/academic-frame';
import { requireStudentSession, studentStatus } from '../_lib/session';

export const dynamic = 'force-dynamic';

export default async function StudentNoticesPage() {
  await requireStudentSession();
  const result = await getSelfNotices();
  const notices = result.payload?.data ?? [];

  return (
    <AcademicFrame
      title="Notices"
      description="School announcements for you."
      testId="student-notices"
      status={studentStatus(result)}
      errorMessage={result.message}
      emptyMessage="There are no school notices right now."
      hasRows={notices.length > 0}
    >
      <ul className="divide-y divide-border" role="list">
        {notices.map((notice) => (
          <li key={notice.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">{notice.title}</p>
            {notice.body ? <p className="mt-1 text-sm text-muted-foreground">{notice.body}</p> : null}
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
