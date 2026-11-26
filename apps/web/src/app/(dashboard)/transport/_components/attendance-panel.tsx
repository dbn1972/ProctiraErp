'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ListChecks, RefreshCw } from 'lucide-react';
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
import { transportAssignmentLabel } from './attendance-labels';

type Direction = 'pickup' | 'drop';
type MarkStatus = 'boarded' | 'alighted' | 'absent';

/** The trip (route × date × direction) the page loaded from its query. */
export interface TripQuery {
  routeId: string;
  tripDate: string;
  direction: Direction;
}

function tripHref(trip: TripQuery): string {
  return `/transport/attendance?${new URLSearchParams({ ...trip }).toString()}`;
}

export function AttendancePanel({
  routes,
  assignments,
  trip,
  tripQuery = null,
  studentLabels = {},
  routeLabels = {},
}: {
  routes: TransportRoute[];
  /**
   * Riders to offer. With a loaded trip these are the riders of that route on
   * the trip date (PRC-M130); otherwise every assignment.
   */
  assignments: StudentAssignment[];
  studentLabels?: Record<string, string>;
  routeLabels?: Record<string, string>;
  trip: {
    data: TripAttendanceRow[];
    summary: { boarded: number; alighted: number; absent: number; unmarked: number };
  } | null;
  tripQuery?: TripQuery | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [routeId, setRouteId] = useState(tripQuery?.routeId ?? '');
  useEffect(() => {
    setHydrated(true);
  }, []);

  // PRC-M130: only riders of the selected route are offered.
  const riders = useMemo(
    () => (routeId ? assignments.filter((a) => a.routeId === routeId) : assignments),
    [assignments, routeId],
  );

  function readTrip(form: HTMLFormElement): TripQuery {
    const fd = new FormData(form);
    return {
      routeId: String(fd.get('routeId') ?? ''),
      tripDate: String(fd.get('tripDate') ?? ''),
      direction: (String(fd.get('direction') ?? 'pickup') === 'drop'
        ? 'drop'
        : 'pickup') as Direction,
    };
  }

  function isLoadedTrip(next: TripQuery): boolean {
    return (
      !!tripQuery &&
      tripQuery.routeId === next.routeId &&
      tripQuery.tripDate === next.tripDate &&
      tripQuery.direction === next.direction
    );
  }

  /** Show the trip's summary and riders: refresh it, or load it when it changed. */
  function showTrip(next: TripQuery) {
    if (isLoadedTrip(next)) router.refresh();
    else router.replace(tripHref(next));
  }

  function stopFor(studentId: string, forRoute: string): string | undefined {
    const assignment = assignments.find((a) => a.studentId === studentId && a.routeId === forRoute);
    return assignment?.stopId || undefined;
  }

  async function mark(next: TripQuery, studentId: string, status: MarkStatus) {
    return upsertTripAttendanceAction({
      ...next,
      studentId,
      stopId: stopFor(studentId, next.routeId),
      status,
    });
  }

  const marked = new Set((trip?.data ?? []).map((row) => row.studentId));
  const unmarkedRiders =
    tripQuery && routeId === tripQuery.routeId
      ? riders.filter((a) => !marked.has(a.studentId))
      : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mark trip attendance</CardTitle>
        <CardDescription>
          Per trip (route × date × pickup/drop). Summary:{' '}
          {trip
            ? `${trip.summary.boarded} boarded · ${trip.summary.alighted} alighted · ${trip.summary.absent} absent · ${trip.summary.unmarked} unmarked`
            : 'choose a route, date and direction, then select Load trip.'}
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
            const form = event.currentTarget;
            const fd = new FormData(form);
            const next = readTrip(form);
            startTransition(async () => {
              setError(null);
              setMessage(null);
              const result = await mark(
                next,
                String(fd.get('studentId') ?? ''),
                String(fd.get('status') ?? 'boarded') as MarkStatus,
              );
              if (result.status === 'error') {
                setError(result.message ?? 'Failed');
                return;
              }
              setMessage(result.message ?? 'Attendance saved.');
              // Keep the trip (route/date/direction) so the next student can be marked.
              const student = form.elements.namedItem('studentId');
              if (student instanceof HTMLSelectElement) student.value = '';
              if (next.routeId && next.tripDate) showTrip(next);
            });
          }}
        >
          <FormField id="att-route" label="Route" required>
            <select
              id="att-route"
              name="routeId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={routeId}
              onChange={(event) => setRouteId(event.target.value)}
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
              <Input
                id="att-date"
                name="tripDate"
                type="date"
                className="h-11 min-h-11"
                defaultValue={tripQuery?.tripDate ?? ''}
              />
            </FormField>
            <FormField id="att-dir" label="Direction" required>
              <select
                id="att-dir"
                name="direction"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue={tripQuery?.direction ?? 'pickup'}
              >
                <option value="pickup">Pickup</option>
                <option value="drop">Drop</option>
              </select>
            </FormField>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pending || routes.length === 0}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (!form) return;
              const next = readTrip(form);
              if (!next.routeId || !next.tripDate) {
                setError('Choose a route and a trip date to load the trip.');
                return;
              }
              setError(null);
              showTrip(next);
            }}
          >
            <RefreshCw className="me-1.5 h-4 w-4" aria-hidden="true" />
            Load trip
          </Button>
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
              {riders.map((a) => (
                <option key={a.id} value={a.studentId}>
                  {transportAssignmentLabel(a.studentId, a.routeId, studentLabels, routeLabels)}
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
          {message ? (
            <p className="text-sm text-muted-foreground" role="status">
              {message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || routes.length === 0}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Saving…' : 'Save mark'}
            </Button>
            {unmarkedRiders.length > 0 && tripQuery ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  if (!form) return;
                  const status = String(
                    new FormData(form).get('status') ?? 'boarded',
                  ) as MarkStatus;
                  startTransition(async () => {
                    setError(null);
                    setMessage(null);
                    let saved = 0;
                    for (const rider of unmarkedRiders) {
                      const result = await mark(tripQuery, rider.studentId, status);
                      if (result.status === 'error') {
                        setError(
                          `Saved ${saved} of ${unmarkedRiders.length} marks. ${result.message ?? 'Failed'}`,
                        );
                        showTrip(tripQuery);
                        return;
                      }
                      saved += 1;
                    }
                    setMessage(`Saved ${saved} marks.`);
                    showTrip(tripQuery);
                  });
                }}
              >
                <ListChecks className="me-1.5 h-4 w-4" aria-hidden="true" />
                Mark {unmarkedRiders.length} unmarked as selected status
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
