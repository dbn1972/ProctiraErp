import { redirect } from 'next/navigation';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasReportRoleDashboardRouteAccess } from '@/lib/auth/domain-route-access';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsDashboardsAliasPage(props: PageProps) {
  // A-batch: check before any report read. The role dashboard admits office
  // `staff` too (REPORT_ROLE_DASHBOARD_ROLE_IDS).
  if (!(await hasReportRoleDashboardRouteAccess('/reports'))) {
    return <RouteAccessDenied />;
  }
  const searchParams = await props.searchParams;
  const role = Array.isArray(searchParams?.role) ? searchParams?.role[0] : searchParams?.role;
  redirect(role ? `/reports/dashboard?role=${encodeURIComponent(role)}` : '/reports/dashboard');
}
