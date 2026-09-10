import { StudentPortalShell } from '@/components/layout/StudentPortalShell';
import { requireSession } from '@/lib/auth/server';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return <StudentPortalShell>{children}</StudentPortalShell>;
}
