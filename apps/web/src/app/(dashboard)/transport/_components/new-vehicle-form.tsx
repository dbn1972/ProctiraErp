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

import { createTransportVehicleAction } from '../actions';

export function NewVehicleForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const registrationNumber = String(fd.get('registrationNumber') ?? '').trim();
    const make = String(fd.get('make') ?? '').trim();
    const model = String(fd.get('model') ?? '').trim();
    const yearRaw = String(fd.get('year') ?? '').trim();
    const capacity = Number(fd.get('capacity'));
    if (!registrationNumber) {
      setError('Registration number is required.');
      return;
    }
    if (!Number.isFinite(capacity) || capacity < 1) {
      setError('Capacity must be at least 1.');
      return;
    }
    const year = yearRaw ? Number(yearRaw) : undefined;
    if (yearRaw && (!Number.isFinite(year) || (year as number) < 1900)) {
      setError('Year must be valid.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createTransportVehicleAction({
        registrationNumber,
        make: make || undefined,
        model: model || undefined,
        year,
        capacity,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create vehicle');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Add vehicle</CardTitle>
        <CardDescription>Creates a fleet record via POST `/transport/vehicles`.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create transport vehicle"
          data-testid="transport-vehicle-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="vehicle-reg" label="Registration number" required>
            <Input id="vehicle-reg" name="registrationNumber" className="h-11 min-h-11" />
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="vehicle-make" label="Make">
              <Input id="vehicle-make" name="make" className="h-11 min-h-11" />
            </FormField>
            <FormField id="vehicle-model" label="Model">
              <Input id="vehicle-model" name="model" className="h-11 min-h-11" />
            </FormField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="vehicle-year" label="Year">
              <Input id="vehicle-year" name="year" type="number" className="h-11 min-h-11" />
            </FormField>
            <FormField id="vehicle-capacity" label="Capacity" required>
              <Input
                id="vehicle-capacity"
                name="capacity"
                type="number"
                min="1"
                defaultValue={40}
                className="h-11 min-h-11"
              />
            </FormField>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Creating…' : 'Add vehicle'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
