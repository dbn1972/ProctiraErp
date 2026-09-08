import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { requireSession } from '@/lib/auth/server';
import { AREA_ROLES, hasRole, type AdminArea } from '@/lib/auth';

/** Authenticated admin shell with sidebar + header. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const role = session.user.platformRole;

  const allowedAreas = (Object.keys(AREA_ROLES) as AdminArea[]).filter((area) =>
    hasRole(role, area),
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar allowedAreas={allowedAreas} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header email={session.user.email} role={role} />
        <main className="flex-1 overflow-y-auto bg-secondary/40 p-6">{children}</main>
      </div>
    </div>
  );
}
