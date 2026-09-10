import { ParentPortalShell } from '@/components/layout/ParentPortalShell';
import { requireSession } from '@/lib/auth/server';

/**
 * Parent portal layout — dedicated shell (not staff MobileShell / AppShell).
 */
export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return <ParentPortalShell>{children}</ParentPortalShell>;
}
