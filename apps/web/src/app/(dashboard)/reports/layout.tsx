/**
 * A-batch (PRC-L034 pattern) — gate all `/reports/*` dashboard routes on report access.
 * Each page also checks before it fetches (see lib/auth/domain-route-access.ts).
 *
 * The layout admits the union of the catalogue set (`reports`) and the role
 * dashboard set: office `staff` may open /reports/dashboard, whose API has no
 * staff check (packages/backend/report/src/catalogue-routes.ts:642). The
 * catalogue pages deny `staff` themselves.
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import {
  canAccessDashboardDomain,
  canAccessReportRoleDashboard,
} from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function ReportsLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/reports');
  if (!canAccessDashboardDomain(session, 'reports') && !canAccessReportRoleDashboard(session)) {
    return <RouteAccessDenied />;
  }
  return children;
}
