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
  // The plaintext key is only returned once (the API stores a hash). Keep it on
  // screen until the user acknowledges storing it (PRC-L251).
  const [issued, setIssued] = useState<{ deviceId: string; deviceKey: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [registeredVehicles, setRegisteredVehicles] = useState<Set<string>>(new Set());

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
              if (issued) return;
              if (
                registeredVehicles.has(vehicleId) &&
                !window.confirm(
                  'A device was already registered for this vehicle. Register another device? The existing device must be deactivated first or the request will be rejected.',
                )
              ) {
                return;
              }
              startTransition(async () => {
                setError(null);
                const result = await registerVehicleDeviceAction(vehicleId, deviceId || undefined);
                if (result.status === 'error') {
                  setError(result.message ?? 'Failed');
                  return;
                }
                setMessage(null);
                setCopied(false);
                setIssued({ deviceId: result.deviceId ?? '', deviceKey: result.deviceKey ?? '' });
                setRegisteredVehicles((prev) => new Set(prev).add(vehicleId));
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
            <Button type="submit" disabled={pending || vehicles.length === 0 || issued !== null}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Registering…' : 'Register device'}
            </Button>
          </form>
          {issued ? (
            <section
              aria-labelledby="dev-key-title"
              data-testid="transport-device-key"
              className="mt-4 space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <h3 id="dev-key-title" className="font-medium" role="status">
                Device {issued.deviceId} registered. Copy the key now; it will not be shown again.
              </h3>
              <FormField id="dev-key-value" label="Device key">
                <Input
                  id="dev-key-value"
                  readOnly
                  value={issued.deviceKey}
                  className="h-11 min-h-11 font-mono"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(issued.deviceKey);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                      setError('Copy failed. Select the key and copy it manually.');
                    }
                  }}
                >
                  {copied ? 'Copied' : 'Copy key'}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setIssued(null);
                    setCopied(false);
                  }}
                >
                  I have stored it
                </Button>
              </div>
            </section>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingest GPS ping</CardTitle>
          <CardDescription>
            Submit a location update from a registered GPS device. Duplicate pings for the same
            device are ignored.
          </CardDescription>
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
                <Input
                  id="gps-lat"
                  name="latitude"
                  type="number"
                  step="0.0001"
                  className="h-11 min-h-11"
                />
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
            <p className="text-xs text-muted-foreground">API: POST /transport/gps</p>
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
