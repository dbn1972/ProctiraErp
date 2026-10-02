import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { StudentPortalShell } from '@/components/layout/StudentPortalShell';
import { requireSession } from '@/lib/auth/server';
import { isStudentPortalSession } from './student/_lib/session';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // PRC-L023: only student-role sessions get the student portal.
  if (!isStudentPortalSession(session)) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <RouteAccessDenied description="The student portal is only available to signed-in students." />
      </main>
    );
  }
  return <StudentPortalShell>{children}</StudentPortalShell>;
}
