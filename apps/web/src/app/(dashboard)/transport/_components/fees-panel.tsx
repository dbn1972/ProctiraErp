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

import { createTransportFeeStructureAction } from '../actions';
import type { TransportRoute } from '@/lib/api/transport';
import type { RouteStop, TransportFeeBand } from '@/lib/transport/api';

export function FeesPanel({
  routes,
  stops,
  bands,
  links,
}: {
  routes: TransportRoute[];
  stops: RouteStop[];
  bands: TransportFeeBand[];
  links: Array<{ id: string; status: string; feesInvoiceId: string | null; reason: string | null }>;
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
          <CardTitle className="text-base">Transport fee band</CardTitle>
          <CardDescription>
            Route or stop-distance band. Creating a band also calls FeesService.createFeeStructure
            (category transport) when the gateway injects G-903. Assigning a student to a stop
            invoices via bulkInvoiceClass, or records a pending link if fees is unavailable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            aria-label="Create transport fee band"
            data-testid="transport-fee-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              const rupees = Number(fd.get('amountRupees'));
              startTransition(async () => {
                setError(null);
                const result = await createTransportFeeStructureAction({
                  name: String(fd.get('name') ?? '').trim(),
                  routeId: String(fd.get('routeId') ?? '') || undefined,
                  stopId: String(fd.get('stopId') ?? '') || undefined,
                  minDistanceKm: String(fd.get('minDistanceKm') ?? '')
                    ? Number(fd.get('minDistanceKm'))
                    : undefined,
                  maxDistanceKm: String(fd.get('maxDistanceKm') ?? '')
                    ? Number(fd.get('maxDistanceKm'))
                    : undefined,
                  amountCents: Math.round(rupees * 100),
                  currency: 'INR',
                });
                if (result.status === 'error') setError(result.message ?? 'Failed');
              });
            }}
          >
            <FormField id="fee-name" label="Name" required>
              <Input id="fee-name" name="name" className="h-11 min-h-11" />
            </FormField>
            <FormField id="fee-route" label="Route (optional)">
              <select
                id="fee-route"
                name="routeId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="">Any route</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="fee-stop" label="Stop (optional)">
              <select
                id="fee-stop"
                name="stopId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="">Any stop</option>
                {stops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="fee-min" label="Min distance (km)">
                <Input id="fee-min" name="minDistanceKm" type="number" min={0} step="0.1" className="h-11 min-h-11" />
              </FormField>
              <FormField id="fee-max" label="Max distance (km)">
                <Input id="fee-max" name="maxDistanceKm" type="number" min={0} step="0.1" className="h-11 min-h-11" />
              </FormField>
            </div>
            <FormField id="fee-amount" label="Amount (INR)" required>
              <Input id="fee-amount" name="amountRupees" type="number" min={0} step="1" className="h-11 min-h-11" />
            </FormField>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Saving…' : 'Create band'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bands</CardTitle>
          <CardDescription>
            {bands.length === 0 ? 'No bands yet.' : `${bands.length} band(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bands.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Empty fee bands.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {bands.map((b) => (
                <li key={b.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(b.amountCents / 100).toFixed(2)} {b.currency}
                    {b.feesStructureId ? ' · fees structure linked' : ' · local band only'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignment fee links</CardTitle>
          <CardDescription>
            invoiced = FeesService created a line; pending = fees API missing or rejected; skipped =
            no matching band.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No fee links yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {links.map((link) => (
                <li key={link.id} className="py-3 first:pt-0 last:pb-0" data-testid="transport-fee-link">
                  <p className="text-sm font-medium">{link.status}</p>
                  <p className="text-xs text-muted-foreground">
                    {link.feesInvoiceId ? `invoice ${link.feesInvoiceId.slice(0, 8)}` : link.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
