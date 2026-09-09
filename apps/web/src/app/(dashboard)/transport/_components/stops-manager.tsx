'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, Trash2 } from 'lucide-react';

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

import { createRouteStopAction, deleteRouteStopAction } from '../actions';
import type { RouteStop } from '@/lib/transport/api';

export function StopsManager({
  routeId,
  stops,
}: {
  routeId: string;
  stops: RouteStop[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const stopOrder = Number(fd.get('stopOrder'));
    const latRaw = String(fd.get('latitude') ?? '').trim();
    const lngRaw = String(fd.get('longitude') ?? '').trim();
    const pickupTime = String(fd.get('pickupTime') ?? '').trim();
    const dropoffTime = String(fd.get('dropoffTime') ?? '').trim();
    if (!name || !Number.isFinite(stopOrder) || stopOrder < 1) {
      setError('Name and a sequence ≥ 1 are required.');
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await createRouteStopAction({
        routeId,
        name,
        stopOrder,
        latitude: latRaw ? Number(latRaw) : undefined,
        longitude: lngRaw ? Number(lngRaw) : undefined,
        pickupTime: pickupTime || undefined,
        dropoffTime: dropoffTime || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      (event.target as HTMLFormElement).reset();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add stop</CardTitle>
          <CardDescription>
            Ordered stop with optional lat/lng and scheduled times. Map uses these coordinates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            onSubmit={onSubmit}
            aria-label="Create route stop"
            data-testid="transport-stop-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <FormField id="stop-name" label="Name" required>
              <Input id="stop-name" name="name" className="h-11 min-h-11" />
            </FormField>
            <FormField id="stop-order" label="Sequence" required>
              <Input
                id="stop-order"
                name="stopOrder"
                type="number"
                min={1}
                defaultValue={stops.length + 1}
                className="h-11 min-h-11"
              />
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="stop-lat" label="Latitude">
                <Input id="stop-lat" name="latitude" type="number" step="0.0001" className="h-11 min-h-11" />
              </FormField>
              <FormField id="stop-lng" label="Longitude">
                <Input
                  id="stop-lng"
                  name="longitude"
                  type="number"
                  step="0.0001"
                  className="h-11 min-h-11"
                />
              </FormField>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="stop-pickup" label="Pickup (HH:MM)">
                <Input id="stop-pickup" name="pickupTime" placeholder="07:15" className="h-11 min-h-11" />
              </FormField>
              <FormField id="stop-drop" label="Drop-off (HH:MM)">
                <Input id="stop-drop" name="dropoffTime" placeholder="15:45" className="h-11 min-h-11" />
              </FormField>
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Saving…' : 'Add stop'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stops</CardTitle>
          <CardDescription>
            {stops.length === 0
              ? 'No stops yet — add the first pickup point.'
              : `${stops.length} stop${stops.length === 1 ? '' : 's'} in sequence.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stops.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Empty stop list.
            </p>
          ) : (
            <ol className="divide-y divide-border" role="list">
              {stops.map((stop) => (
                <li
                  key={stop.id}
                  className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  data-testid="transport-stop-row"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {stop.stopOrder}. {stop.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {stop.latitude != null && stop.longitude != null
                        ? `${stop.latitude}, ${stop.longitude}`
                        : 'No coordinates'}
                      {stop.pickupTime ? ` · pickup ${stop.pickupTime}` : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      startTransition(async () => {
                        const result = await deleteRouteStopAction(stop.id, routeId);
                        if (result.status === 'error') setError(result.message ?? 'Failed');
                      });
                    }}
                  >
                    <Trash2 className="me-1.5 h-4 w-4" aria-hidden="true" />
                    Remove
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
