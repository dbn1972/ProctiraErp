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
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { ApplicationBundle } from '@/lib/api/admissions';
import { formatQuotaLabel, resolveQuotaFromForm } from '@/lib/admissions/quota-categories';
import { setPlacementScoresAction } from '../../admissions-actions';
import { QuotaCategoryField } from './quota-category-field';

interface Option {
  id: string;
  name: string;
}

const selectClassName =
  'flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm';

export function PlacementPanel({
  bundle,
  periods,
  grades,
}: {
  bundle: ApplicationBundle;
  periods: Option[];
  grades: Option[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const placement = bundle.placement;
  const lookupsMissing = periods.length === 0 || grades.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Placement & entrance scores</CardTitle>
        <CardDescription>
          Required before drafting an offer. Scores feed merit ranking for this grade and period.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {placement ? (
          <p
            className="text-sm text-muted-foreground"
            role="status"
            data-testid="placement-summary"
          >
            Current: category{' '}
            <strong className="text-foreground">{formatQuotaLabel(placement.quota)}</strong> (
            {placement.quota}) · interview {placement.interviewScore} · entrance/test{' '}
            {placement.testScore}
          </p>
        ) : (
          <p
            className="text-sm text-muted-foreground"
            role="status"
            data-testid="placement-missing"
          >
            No placement yet. Set grade, period, category, and scores below.
          </p>
        )}

        {lookupsMissing ? (
          <p className="text-sm text-muted-foreground" role="status">
            Academic periods and grades are required before placement can be saved.
          </p>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            data-testid="placement-form"
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
                setMessage(null);
                const result = await setPlacementScoresAction({
                  applicationId: bundle.application.id,
                  academicPeriodId: String(fd.get('academicPeriodId') ?? ''),
                  gradeId: String(fd.get('gradeId') ?? ''),
                  quota,
                  interviewScore: Number(fd.get('interviewScore') ?? 0),
                  testScore: Number(fd.get('testScore') ?? 0),
                });
                if (result.status === 'error') {
                  setError(result.message ?? 'Failed');
                  return;
                }
                setMessage(result.message ?? 'Saved.');
                router.refresh();
              });
            }}
          >
            <FormField id="placement-period" label="Period" required>
              <select
                id="placement-period"
                name="academicPeriodId"
                data-testid="placement-period"
                className={selectClassName}
                disabled={!hydrated || pending}
                defaultValue={placement?.academicPeriodId ?? periods[0]?.id ?? ''}
              >
                {periods.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="placement-grade" label="Grade" required>
              <select
                id="placement-grade"
                name="gradeId"
                data-testid="placement-grade"
                className={selectClassName}
                disabled={!hydrated || pending}
                defaultValue={placement?.gradeId ?? grades[0]?.id ?? ''}
              >
                {grades.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </FormField>
            <QuotaCategoryField
              id="placement-quota"
              testIdPrefix="placement-quota"
              defaultQuota={placement?.quota ?? 'general'}
              disabled={!hydrated || pending}
            />
            <FormField id="placement-interview" label="Interview score" required>
              <Input
                id="placement-interview"
                name="interviewScore"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={placement?.interviewScore ?? 0}
                data-testid="placement-interview"
                disabled={!hydrated || pending}
              />
            </FormField>
            <FormField id="placement-test" label="Entrance / test score" required>
              <Input
                id="placement-test"
                name="testScore"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={placement?.testScore ?? 0}
                data-testid="placement-test"
                disabled={!hydrated || pending}
              />
            </FormField>
            {error ? (
              <p
                className="text-sm text-destructive sm:col-span-2"
                role="alert"
                data-testid="placement-error"
              >
                {error}
              </p>
            ) : null}
            {message ? (
              <p
                className="text-sm text-muted-foreground sm:col-span-2"
                role="status"
                data-testid="placement-success"
              >
                {message}
              </p>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit" data-testid="save-placement" disabled={!hydrated || pending}>
                {pending ? 'Saving…' : placement ? 'Update placement' : 'Save placement'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
