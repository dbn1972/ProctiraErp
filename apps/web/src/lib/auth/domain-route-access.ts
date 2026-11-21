/**
 * T-D1 — page-level check for dashboard domain routes.
 *
 * A layout guard alone does not stop a page from running: Next.js renders each
 * page segment separately from its layout (the page's RSC payload is produced
 * even when the layout does not render `children`, and soft navigation renders
 * only the changed segment). Pages that fetch domain data call this first and
 * render `RouteAccessDenied` when it returns false, before any read.
 */
import {
  canAccessDashboardDomain,
  canAccessReportRoleDashboard,
  type DashboardDomain,
} from './domain-route-guards';
import { requireSession } from './server';

export async function hasDashboardDomainRouteAccess(
  domain: DashboardDomain,
  returnTo: string,
): Promise<boolean> {
  const session = await requireSession(returnTo);
  return canAccessDashboardDomain(session, domain);
}

/** Page check for `/reports/dashboard` and `/reports/dashboards` (see REPORT_ROLE_DASHBOARD_ROLE_IDS). */
export async function hasReportRoleDashboardRouteAccess(returnTo: string): Promise<boolean> {
  const session = await requireSession(returnTo);
  return canAccessReportRoleDashboard(session);
}
