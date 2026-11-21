import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';
import { listTransportRoutes } from '@/lib/api/transport';
import { listAlertRules, listAlerts } from '@/lib/transport/api';
import { AlertsPanel } from '../_components/alerts-panel';

export const dynamic = 'force-dynamic';

export default async function TransportAlertsPage() {
  // T-D1: check before any transport or student-directory read.
  if (!(await hasDashboardDomainRouteAccess('transport', '/transport'))) {
    return <RouteAccessDenied />;
  }
  const [routes, rules, alerts] = await Promise.all([
    listTransportRoutes(),
    listAlertRules(),
    listAlerts(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transport alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Delay, geofence, and missed-pickup rules. Evaluate against latest pings and trip
          attendance.
        </p>
      </div>
      <AlertsPanel routes={routes} rules={rules} alerts={alerts} />
    </div>
  );
}
