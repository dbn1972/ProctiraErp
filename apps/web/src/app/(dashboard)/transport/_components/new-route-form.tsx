'use client';

/**
 * Client form for creating a transport route.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Check } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  FormField,
  Input,
  Textarea,
} from '@proctira/ui/components';

import { createTransportRouteAction } from '../actions';
import type { OperatingDay } from '@/lib/api/transport';

const WEEKDAYS: { value: OperatingDay; label: string }[] = [
  { value: 'monday', label: 'Mon' },
  { value: 'tuesday', label: 'Tue' },
  { value: 'wednesday', label: 'Wed' },
  { value: 'thursday', label: 'Thu' },
  { value: 'friday', label: 'Fri' },
  { value: 'saturday', label: 'Sat' },
  { value: 'sunday', label: 'Sun' },
];

export function NewRouteForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [days, setDays] = useState<OperatingDay[]>([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
  ]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function toggleDay(day: OperatingDay, checked: boolean) {
    setDays((prev) => {
      if (checked) return prev.includes(day) ? prev : [...prev, day];
      return prev.filter((d) => d !== day);
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const description = String(fd.get('description') ?? '').trim();
    const startLocation = String(fd.get('startLocation') ?? '').trim();
    const endLocation = String(fd.get('endLocation') ?? '').trim();
    const departureTime = String(fd.get('departureTime') ?? '').trim();
    const returnTime = String(fd.get('returnTime') ?? '').trim();
    const distanceRaw = String(fd.get('distanceKm') ?? '').trim();
    const durationRaw = String(fd.get('estimatedDurationMinutes') ?? '').trim();

    if (!name) {
      setError('Name is required.');
      return;
    }
    if (!startLocation || !endLocation) {
      setError('Start and end locations are required.');
      return;
    }
    if (days.length === 0) {
      setError('Select at least one operating day.');
      return;
    }

    const distanceKm = distanceRaw ? Number(distanceRaw) : undefined;
    const estimatedDurationMinutes = durationRaw ? Number(durationRaw) : undefined;
    if (distanceRaw && (!Number.isFinite(distanceKm) || (distanceKm as number) < 0)) {
      setError('Distance must be a non-negative number.');
      return;
    }
    if (
      durationRaw &&
      (!Number.isFinite(estimatedDurationMinutes) || (estimatedDurationMinutes as number) < 1)
    ) {
      setError('Duration must be at least 1 minute.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createTransportRouteAction({
        name,
        description: description || undefined,
        startLocation,
        endLocation,
        operatingDays: days,
        departureTime: departureTime || undefined,
        returnTime: returnTime || undefined,
        distanceKm,
        estimatedDurationMinutes,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create route');
        return;
      }
      router.push(result.routeId ? `/transport/routes` : '/transport/routes');
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[860px]">
      <CardHeader>
        <CardTitle className="text-base">Route details</CardTitle>
        <CardDescription>
          Define the corridor, operating days, and optional schedule times.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create transport route"
          data-testid="transport-route-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="route-name" label="Name" required>
            <Input
              id="route-name"
              name="name"
              placeholder="North Campus Loop"
              className="h-11 min-h-11"
            />
          </FormField>
          <FormField id="route-description" label="Description">
            <Textarea
              id="route-description"
              name="description"
              rows={3}
              placeholder="Optional notes for drivers and parents…"
              className="min-h-20"
            />
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="route-start" label="Start location" required>
              <Input
                id="route-start"
                name="startLocation"
                placeholder="Depot / first stop"
                className="h-11 min-h-11"
              />
            </FormField>
            <FormField id="route-end" label="End location" required>
              <Input
                id="route-end"
                name="endLocation"
                placeholder="School gate"
                className="h-11 min-h-11"
              />
            </FormField>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">
              Operating days <span className="text-destructive">*</span>
            </legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((day) => {
                const checked = days.includes(day.value);
                return (
                  <label
                    key={day.value}
                    className="inline-flex min-h-11 items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleDay(day.value, value === true)}
                      aria-label={day.label}
                    />
                    <span>{day.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="route-depart" label="Departure (HH:MM)">
              <Input
                id="route-depart"
                name="departureTime"
                placeholder="07:15"
                pattern="\d{2}:\d{2}"
                className="h-11 min-h-11"
              />
            </FormField>
            <FormField id="route-return" label="Return (HH:MM)">
              <Input
                id="route-return"
                name="returnTime"
                placeholder="15:30"
                pattern="\d{2}:\d{2}"
                className="h-11 min-h-11"
              />
            </FormField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="route-distance" label="Distance (km)">
              <Input
                id="route-distance"
                name="distanceKm"
                type="number"
                min="0"
                step="0.1"
                className="h-11 min-h-11"
              />
            </FormField>
            <FormField id="route-duration" label="Duration (minutes)">
              <Input
                id="route-duration"
                name="estimatedDurationMinutes"
                type="number"
                min="1"
                className="h-11 min-h-11"
              />
            </FormField>
          </div>

          {error ? (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="transport-route-error"
            >
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <Button asChild variant="outline" type="button">
              <Link href="/transport/routes">Cancel</Link>
            </Button>
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Creating…' : 'Create route'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
