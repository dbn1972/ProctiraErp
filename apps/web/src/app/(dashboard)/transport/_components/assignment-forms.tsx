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

import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { TransportRoute, TransportVehicle } from '@/lib/api/transport';
import type { EntityLabelOption } from '@/lib/entity-label';
import type { RouteStop } from '@/lib/transport/api';
import { createDriverAssignmentAction, createStudentAssignmentAction } from '../actions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function AssignmentForms({
  routes,
  vehicles,
  stops,
  studentOptions = [],
  staffOptions = [],
}: {
  routes: TransportRoute[];
  vehicles: TransportVehicle[];
  stops: RouteStop[];
  studentOptions?: EntityLabelOption[];
  staffOptions?: EntityLabelOption[];
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
      setError(
        vehicles.length === 0 || staffOptions.length === 0
          ? 'Vehicle list or staff directory is empty — add those records before assigning a driver.'
          : 'Select a vehicle and a driver.',
      );
      return;
    }
    if (routeId && !UUID_RE.test(routeId)) {
      setError('Select a route from the list, or leave route blank.');
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
      setError(
        studentOptions.length === 0 || routes.length === 0
          ? 'Student directory or route list is empty — add those records before assigning a student.'
          : 'Select a student and a route.',
      );
      return;
    }
    if (stopId && !UUID_RE.test(stopId)) {
      setError('Select a stop from the list, or leave stop blank.');
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
            <CardDescription>Assign a driver to a vehicle and optional route.</CardDescription>
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
              <EntitySearchSelect
                id="driver-id"
                name="driverId"
                label="Driver"
                options={staffOptions}
                required
              />
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
            <CardDescription>Assign a student to a route and stop.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              noValidate
              onSubmit={onStudentSubmit}
              aria-label="Create student assignment"
              data-testid="transport-student-assignment-form"
            >
              <EntitySearchSelect
                id="student-id"
                name="studentId"
                label="Student"
                options={studentOptions}
                required
              />
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
