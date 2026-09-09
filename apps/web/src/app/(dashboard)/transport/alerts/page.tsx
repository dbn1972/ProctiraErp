import { requireSession } from '@/lib/auth/server';
import { listTransportRoutes } from '@/lib/api/transport';
import { listAlertRules, listAlerts } from '@/lib/transport/api';
import { AlertsPanel } from '../_components/alerts-panel';

export const dynamic = 'force-dynamic';

export default async function TransportAlertsPage() {
  await requireSession();
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
          Delay, geofence, and missed-pickup rules. Evaluate against latest pings and trip attendance.
        </p>
      </div>
      <AlertsPanel routes={routes} rules={rules} alerts={alerts} />
    </div>
  );
}
