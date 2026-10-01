/**
 * PRC-L234 — web-tier gate for every `/admin/*` page. The gateway maps tenant
 * administration to `user:manage` and stays authoritative; this denies the UI
 * up front instead of rendering pages whose every request will 403.
 */
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessAdminRoutes } from '@/lib/auth/permission-guards';
import { requireSession } from '@/lib/auth/server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession('/admin');
  if (!canAccessAdminRoutes(session)) {
    return (
      <RouteAccessDenied description="Administration requires the tenant administrator role. Contact your administrator if you need access." />
    );
  }
  return children;
}
