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

import { upsertTripAttendanceAction } from '../actions';
import type { TransportRoute, StudentAssignment } from '@/lib/api/transport';
import type { TripAttendanceRow } from '@/lib/transport/api';

export function AttendancePanel({
  routes,
  assignments,
  trip,
}: {
  routes: TransportRoute[];
  assignments: StudentAssignment[];
  trip: {
    data: TripAttendanceRow[];
    summary: { boarded: number; alighted: number; absent: number; unmarked: number };
  } | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mark trip attendance</CardTitle>
        <CardDescription>
          Per trip (route × date × pickup/drop). Summary:{' '}
          {trip
            ? `${trip.summary.boarded} boarded · ${trip.summary.alighted} alighted · ${trip.summary.absent} absent · ${trip.summary.unmarked} unmarked`
            : 'select a trip and load the page query.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          aria-label="Record bus attendance"
          data-testid="transport-attendance-form"
          data-hydrated={hydrated ? 'true' : 'false'}
          onSubmit={(event) => {
            event.preventDefault();
            const fd = new FormData(event.currentTarget);
            startTransition(async () => {
              setError(null);
              const result = await upsertTripAttendanceAction({
                routeId: String(fd.get('routeId') ?? ''),
                tripDate: String(fd.get('tripDate') ?? ''),
                direction: String(fd.get('direction') ?? 'pickup') as 'pickup' | 'drop',
                studentId: String(fd.get('studentId') ?? ''),
                stopId: String(fd.get('stopId') ?? '') || undefined,
                status: String(fd.get('status') ?? 'boarded') as 'boarded' | 'alighted' | 'absent',
              });
              if (result.status === 'error') setError(result.message ?? 'Failed');
            });
          }}
        >
          <FormField id="att-route" label="Route" required>
            <select
              id="att-route"
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
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="att-date" label="Trip date" required>
              <Input id="att-date" name="tripDate" type="date" className="h-11 min-h-11" />
            </FormField>
            <FormField id="att-dir" label="Direction" required>
              <select
                id="att-dir"
                name="direction"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="pickup"
              >
                <option value="pickup">Pickup</option>
                <option value="drop">Drop</option>
              </select>
            </FormField>
          </div>
          <FormField id="att-student" label="Student" required>
            <select
              id="att-student"
              name="studentId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Assigned student…
              </option>
              {assignments.map((a) => (
                <option key={a.id} value={a.studentId}>
                  {a.studentId.slice(0, 8)} · route {a.routeId.slice(0, 8)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="att-status" label="Status" required>
            <select
              id="att-status"
              name="status"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue="boarded"
            >
              <option value="boarded">Boarded</option>
              <option value="alighted">Alighted</option>
              <option value="absent">Absent</option>
            </select>
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending || routes.length === 0}>
            <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
            {pending ? 'Saving…' : 'Save mark'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
