'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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

import { createDriverAssignmentAction, createStudentAssignmentAction } from '../actions';
import type { TransportRoute, TransportVehicle } from '@/lib/api/transport';
import type { RouteStop } from '@/lib/transport/api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function AssignmentForms({
  routes,
  vehicles,
  stops,
}: {
  routes: TransportRoute[];
  vehicles: TransportVehicle[];
  stops: RouteStop[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function onDriverSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const vehicleId = String(fd.get('vehicleId') ?? '').trim();
    const driverId = String(fd.get('driverId') ?? '').trim();
    const routeId = String(fd.get('routeId') ?? '').trim();
    const startDate = String(fd.get('startDate') ?? '').trim();
    const endDate = String(fd.get('endDate') ?? '').trim();
    if (!UUID_RE.test(vehicleId) || !UUID_RE.test(driverId)) {
      setError('Vehicle and driver must be UUID v4 values.');
      return;
    }
    if (routeId && !UUID_RE.test(routeId)) {
      setError('Route id must be a UUID v4 when provided.');
      return;
    }
    if (!startDate) {
      setError('Start date is required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await createDriverAssignmentAction({
        vehicleId,
        driverId,
        routeId: routeId || undefined,
        startDate,
        endDate: endDate || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Driver assignment failed');
        return;
      }
      setMessage(result.message ?? 'Saved.');
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  function onStudentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const studentId = String(fd.get('studentId') ?? '').trim();
    const routeId = String(fd.get('routeId') ?? '').trim();
    const stopId = String(fd.get('stopId') ?? '').trim();
    const startDate = String(fd.get('startDate') ?? '').trim();
    const endDate = String(fd.get('endDate') ?? '').trim();
    if (!UUID_RE.test(studentId) || !UUID_RE.test(routeId)) {
      setError('Student and route must be UUID v4 values.');
      return;
    }
    if (stopId && !UUID_RE.test(stopId)) {
      setError('Stop id must be a UUID v4 when provided.');
      return;
    }
    if (!startDate) {
      setError('Start date is required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await createStudentAssignmentAction({
        studentId,
        routeId,
        stopId: stopId || undefined,
        startDate,
        endDate: endDate || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Student assignment failed');
        return;
      }
      setMessage(result.message ?? 'Saved.');
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assign driver</CardTitle>
            <CardDescription>POST `/transport/driver-assignments`</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              noValidate
              onSubmit={onDriverSubmit}
              aria-label="Create driver assignment"
              data-testid="transport-driver-assignment-form"
              data-hydrated={hydrated ? 'true' : 'false'}
            >
              <FormField id="driver-vehicle" label="Vehicle" required>
                <select
                  id="driver-vehicle"
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
              <FormField id="driver-id" label="Driver staff UUID" required>
                <Input id="driver-id" name="driverId" className="h-11 min-h-11" />
              </FormField>
              <FormField id="driver-route" label="Route (optional)">
                <select
                  id="driver-route"
                  name="routeId"
                  className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue=""
                >
                  <option value="">None</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField id="driver-start" label="Start date" required>
                  <Input id="driver-start" name="startDate" type="date" className="h-11 min-h-11" />
                </FormField>
                <FormField id="driver-end" label="End date">
                  <Input id="driver-end" name="endDate" type="date" className="h-11 min-h-11" />
                </FormField>
              </div>
              <Button type="submit" disabled={pending || vehicles.length === 0}>
                <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                {pending ? 'Saving…' : 'Assign driver'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assign student</CardTitle>
            <CardDescription>POST `/transport/student-assignments`</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              noValidate
              onSubmit={onStudentSubmit}
              aria-label="Create student assignment"
              data-testid="transport-student-assignment-form"
            >
              <FormField id="student-id" label="Student UUID" required>
                <Input id="student-id" name="studentId" className="h-11 min-h-11" />
              </FormField>
              <FormField id="student-route" label="Route" required>
                <select
                  id="student-route"
                  name="routeId"
                  className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select route…
                  </option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="student-stop" label="Stop">
                <select
                  id="student-stop"
                  name="stopId"
                  className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue=""
                >
                  <option value="">No stop</option>
                  {stops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField id="student-start" label="Start date" required>
                  <Input
                    id="student-start"
                    name="startDate"
                    type="date"
                    className="h-11 min-h-11"
                  />
                </FormField>
                <FormField id="student-end" label="End date">
                  <Input id="student-end" name="endDate" type="date" className="h-11 min-h-11" />
                </FormField>
              </div>
              <Button type="submit" disabled={pending || routes.length === 0}>
                <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                {pending ? 'Saving…' : 'Assign student'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
