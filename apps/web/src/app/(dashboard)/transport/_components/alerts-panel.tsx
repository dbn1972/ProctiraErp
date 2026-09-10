'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';

import { acknowledgeAlertAction, createAlertRuleAction, evaluateAlertsAction } from '../actions';
import type { TransportRoute } from '@/lib/api/transport';
import type { AlertRule, TransportAlert } from '@/lib/transport/api';

export function AlertsPanel({
  routes,
  rules,
  alerts,
}: {
  routes: TransportRoute[];
  rules: AlertRule[];
  alerts: TransportAlert[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert rule</CardTitle>
          <CardDescription>
            delay_minutes, geofence_exit (metres), or missed_pickup. Channels are stored; dispatch
            is not sent in this slice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            aria-label="Create alert rule"
            data-testid="transport-alert-rule-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              startTransition(async () => {
                setError(null);
                const result = await createAlertRuleAction({
                  kind: String(fd.get('kind')) as AlertRule['kind'],
                  threshold: Number(fd.get('threshold')),
                  routeId: String(fd.get('routeId') ?? '') || undefined,
                });
                if (result.status === 'error') setError(result.message ?? 'Failed');
              });
            }}
          >
            <FormField id="rule-kind" label="Kind" required>
              <select
                id="rule-kind"
                name="kind"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="delay_minutes"
              >
                <option value="delay_minutes">Delay (minutes)</option>
                <option value="geofence_exit">Geofence exit (metres)</option>
                <option value="missed_pickup">Missed pickup (minutes)</option>
              </select>
            </FormField>
            <FormField id="rule-threshold" label="Threshold" required>
              <Input
                id="rule-threshold"
                name="threshold"
                type="number"
                min={0}
                className="h-11 min-h-11"
              />
            </FormField>
            <FormField id="rule-route" label="Route (optional)">
              <select
                id="rule-route"
                name="routeId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="">All routes</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={pending}>
                <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                {pending ? 'Saving…' : 'Create rule'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await evaluateAlertsAction();
                    if (result.status === 'error') setError(result.message ?? 'Failed');
                  });
                }}
              >
                Evaluate now
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rules</CardTitle>
          <CardDescription>
            {rules.length === 0 ? 'No rules yet.' : `${rules.length} rule(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Empty rules list.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {rules.map((rule) => (
                <li key={rule.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium">
                    {rule.kind} · threshold {rule.threshold}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {rule.isActive ? 'active' : 'inactive'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alerts</CardTitle>
          <CardDescription>
            {alerts.length === 0 ? 'No alerts yet.' : `${alerts.length} alert(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Empty alerts list.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  data-testid="transport-alert-row"
                >
                  <div>
                    <p className="text-sm font-medium">{alert.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {alert.kind}
                      {alert.acknowledgedAt ? ' · acknowledged' : ''}
                    </p>
                  </div>
                  {!alert.acknowledgedAt ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        startTransition(async () => {
                          const result = await acknowledgeAlertAction(alert.id);
                          if (result.status === 'error') setError(result.message ?? 'Failed');
                        });
                      }}
                    >
                      Acknowledge
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
