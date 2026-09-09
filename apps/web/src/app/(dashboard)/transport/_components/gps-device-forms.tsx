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

import { ingestGpsPingAction, registerVehicleDeviceAction } from '../actions';
import type { TransportVehicle } from '@/lib/api/transport';

export function GpsDeviceForms({ vehicles }: { vehicles: TransportVehicle[] }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register GPS device</CardTitle>
          <CardDescription>
            Issues a per-vehicle device key (shown once). Send it as X-Transport-Device-Key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            aria-label="Register GPS device"
            data-testid="transport-device-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              const vehicleId = String(fd.get('vehicleId') ?? '');
              const deviceId = String(fd.get('deviceId') ?? '').trim();
              startTransition(async () => {
                setError(null);
                const result = await registerVehicleDeviceAction(vehicleId, deviceId || undefined);
                if (result.status === 'error') {
                  setError(result.message ?? 'Failed');
                  return;
                }
                setMessage(
                  `Device ${result.deviceId}. Key (copy now): ${result.deviceKey}`,
                );
              });
            }}
          >
            <FormField id="dev-vehicle" label="Vehicle" required>
              <select
                id="dev-vehicle"
                name="vehicleId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="" disabled>
                  Select vehicle…
                </option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNumber}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="dev-id" label="Device id (optional)">
              <Input id="dev-id" name="deviceId" className="h-11 min-h-11" />
            </FormField>
            <Button type="submit" disabled={pending || vehicles.length === 0}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Registering…' : 'Register device'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingest GPS ping</CardTitle>
          <CardDescription>POST /transport/gps — idempotent by deviceId + pingId.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            aria-label="Ingest GPS ping"
            data-testid="transport-gps-form"
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              startTransition(async () => {
                setError(null);
                const result = await ingestGpsPingAction({
                  deviceId: String(fd.get('deviceId') ?? '').trim(),
                  deviceKey: String(fd.get('deviceKey') ?? '').trim(),
                  pingId: String(fd.get('pingId') ?? '').trim(),
                  latitude: Number(fd.get('latitude')),
                  longitude: Number(fd.get('longitude')),
                });
                if (result.status === 'error') {
                  setError(result.message ?? 'Failed');
                  return;
                }
                setMessage(result.message ?? 'Ping stored.');
              });
            }}
          >
            <FormField id="gps-device" label="Device id" required>
              <Input id="gps-device" name="deviceId" className="h-11 min-h-11" />
            </FormField>
            <FormField id="gps-key" label="Device key" required>
              <Input id="gps-key" name="deviceKey" className="h-11 min-h-11" />
            </FormField>
            <FormField id="gps-ping" label="Ping id" required>
              <Input id="gps-ping" name="pingId" className="h-11 min-h-11" />
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="gps-lat" label="Latitude" required>
                <Input id="gps-lat" name="latitude" type="number" step="0.0001" className="h-11 min-h-11" />
              </FormField>
              <FormField id="gps-lng" label="Longitude" required>
                <Input
                  id="gps-lng"
                  name="longitude"
                  type="number"
                  step="0.0001"
                  className="h-11 min-h-11"
                />
              </FormField>
            </div>
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Sending…' : 'Send ping'}
            </Button>
          </form>
        </CardContent>
      </Card>
      {error ? (
        <p className="text-sm text-destructive lg:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground lg:col-span-2" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
