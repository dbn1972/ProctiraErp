'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { SeatMatrixRow } from '@/lib/api/admissions';
import { upsertSeatMatrixAction } from '../../admissions-actions';

interface Option {
  id: string;
  name: string;
}

export function SeatMatrixPanel({
  rows,
  institutions,
  periods,
  grades,
}: {
  rows: SeatMatrixRow[];
  institutions: Option[];
  periods: Option[];
  grades: Option[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit seat matrix</CardTitle>
          <CardDescription>Seats per institution × period × grade × quota.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
            data-testid="seat-matrix-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              startTransition(async () => {
                setError(null);
                const result = await upsertSeatMatrixAction({
                  institutionId: String(fd.get('institutionId') ?? ''),
                  academicPeriodId: String(fd.get('academicPeriodId') ?? ''),
                  gradeId: String(fd.get('gradeId') ?? ''),
                  quota: String(fd.get('quota') ?? 'general'),
                  seats: Number(fd.get('seats') ?? 0),
                });
                if (result.status === 'error') {
                  setError(result.message ?? 'Failed');
                  return;
                }
                router.refresh();
              });
            }}
          >
            <FormField id="seat-institution" label="Institution" required>
              <select
                id="seat-institution"
                name="institutionId"
                data-testid="seat-institution"
                className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={!hydrated || pending}
                defaultValue={institutions[0]?.id ?? ''}
              >
                {institutions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="seat-period" label="Period" required>
              <select
                id="seat-period"
                name="academicPeriodId"
                data-testid="seat-period"
                className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={!hydrated || pending}
                defaultValue={periods[0]?.id ?? ''}
              >
                {periods.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="seat-grade" label="Grade" required>
              <select
                id="seat-grade"
                name="gradeId"
                data-testid="seat-grade"
                className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={!hydrated || pending}
                defaultValue={grades[0]?.id ?? ''}
              >
                {grades.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="seat-quota" label="Quota">
              <Input
                id="seat-quota"
                name="quota"
                defaultValue="general"
                data-testid="seat-quota"
                disabled={!hydrated || pending}
              />
            </FormField>
            <FormField id="seat-count" label="Seats" required>
              <Input
                id="seat-count"
                name="seats"
                type="number"
                min={0}
                defaultValue={1}
                data-testid="seat-count"
                disabled={!hydrated || pending}
              />
            </FormField>
            {error ? (
              <p className="text-sm text-destructive sm:col-span-2" role="alert">
                {error}
              </p>
            ) : null}
            <div className="sm:col-span-2 lg:col-span-5">
              <Button type="submit" data-testid="save-seat" disabled={!hydrated || pending}>
                {pending ? 'Saving…' : 'Save row'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live availability</CardTitle>
          <CardDescription>Filled counts come from accepted offers.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid="seat-empty">
              No seat rows yet.
            </p>
          ) : (
            <Table data-testid="seat-matrix-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Quota</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead>Filled</TableHead>
                  <TableHead>Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="seat-row">
                    <TableCell>{row.quota}</TableCell>
                    <TableCell>{row.seats}</TableCell>
                    <TableCell>{row.filled}</TableCell>
                    <TableCell>{row.available}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
