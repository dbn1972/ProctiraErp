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
import { formatQuotaLabel, resolveQuotaFromForm } from '@/lib/admissions/quota-categories';
import { upsertSeatMatrixAction } from '../../admissions-actions';
import { QuotaCategoryField } from './quota-category-field';

interface Option {
  id: string;
  name: string;
}

function nameOf(options: Option[], id: string): string {
  return options.find((row) => row.id === id)?.name ?? id.slice(0, 8);
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
  const lookupsMissing = institutions.length === 0 || periods.length === 0 || grades.length === 0;

  return (
    <div className="space-y-6">
      <p
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        role="note"
        data-testid="seat-honesty"
      >
        Category / reservation is the existing <code className="text-xs">quota</code> key on each
        seat row (one seats count per institution × period × grade × category). There is no separate
        multi-rule reservation engine or reserved-percentage schema in this release.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit seat matrix</CardTitle>
          <CardDescription>
            Upsert seats for a category/reservation bucket. Saving the same key updates that row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lookupsMissing ? (
            <p
              className="text-sm text-muted-foreground"
              role="status"
              data-testid="seat-lookups-empty"
            >
              Institutions, academic periods, and grades are required before you can edit the
              matrix. Configure them under Institutions, then return here.
            </p>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="seat-matrix-form"
              data-hydrated={hydrated ? 'true' : 'false'}
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault();
                const fd = new FormData(event.currentTarget);
                const quota = resolveQuotaFromForm(
                  String(fd.get('quotaPreset') ?? 'general'),
                  String(fd.get('quotaCustom') ?? ''),
                );
                startTransition(async () => {
                  setError(null);
                  const result = await upsertSeatMatrixAction({
                    institutionId: String(fd.get('institutionId') ?? ''),
                    academicPeriodId: String(fd.get('academicPeriodId') ?? ''),
                    gradeId: String(fd.get('gradeId') ?? ''),
                    quota,
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
              <QuotaCategoryField
                id="seat-quota"
                testIdPrefix="seat-quota"
                disabled={!hydrated || pending}
              />
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
                <p
                  className="text-sm text-destructive sm:col-span-2"
                  role="alert"
                  data-testid="seat-error"
                >
                  {error}
                </p>
              ) : null}
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit" data-testid="save-seat" disabled={!hydrated || pending}>
                  {pending ? 'Saving…' : 'Save category row'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live availability</CardTitle>
          <CardDescription>
            Filled counts come from accepted offers on the matching category key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid="seat-empty">
              No seat rows yet. Save a category/reservation row above to start tracking
              availability.
            </p>
          ) : (
            <Table data-testid="seat-matrix-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Institution</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead>Filled</TableHead>
                  <TableHead>Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="seat-row" data-quota={row.quota}>
                    <TableCell>{nameOf(institutions, row.institutionId)}</TableCell>
                    <TableCell>{nameOf(periods, row.academicPeriodId)}</TableCell>
                    <TableCell>{nameOf(grades, row.gradeId)}</TableCell>
                    <TableCell>
                      <span className="font-medium">{formatQuotaLabel(row.quota)}</span>
                      {formatQuotaLabel(row.quota) !== row.quota ? (
                        <span className="ml-1 text-xs text-muted-foreground">({row.quota})</span>
                      ) : null}
                    </TableCell>
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
