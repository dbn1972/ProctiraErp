'use client';

import { useState, useTransition } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/hooks/useHydrated';
import type { ReportTemplate } from '@/lib/reports/api';

import { createReportScheduleAction } from '../actions';

const selectClassName = cn(
  'flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2',
  'text-sm text-foreground shadow-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

interface ScheduleFormProps {
  templates: ReportTemplate[];
}

export function ReportScheduleForm({ templates }: ScheduleFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createReportScheduleAction({
        reportKey: String(form.get('reportKey') ?? ''),
        format: String(form.get('format') ?? 'csv'),
        cadence: String(form.get('cadence') ?? 'daily'),
        hour: String(form.get('hour') ?? '6'),
        recipients: String(form.get('recipients') ?? ''),
        enabled: true,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create schedule');
        return;
      }
      setSuccess(result.message ?? 'Schedule created');
      event.currentTarget.reset();
    });
  }

  return (
    <form
      className="space-y-4"
      data-testid="report-schedule-form"
      data-hydrated={hydrated ? 'true' : 'false'}
      onSubmit={onSubmit}
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="schedule-report" label="Report" required>
            <select id="schedule-report" name="reportKey" className={selectClassName} required>
              <option value="">Select a report</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.reportKey ?? tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="schedule-format" label="Format" required>
            <select
              id="schedule-format"
              name="format"
              className={selectClassName}
              defaultValue="csv"
            >
              <option value="csv">CSV</option>
              <option value="xlsx">XLSX</option>
              <option value="pdf">PDF</option>
            </select>
          </FormField>
          <FormField id="schedule-cadence" label="Cadence" required>
            <select
              id="schedule-cadence"
              name="cadence"
              className={selectClassName}
              defaultValue="daily"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </FormField>
          <FormField id="schedule-hour" label="Hour (UTC)" required>
            <Input id="schedule-hour" name="hour" type="number" min={0} max={23} defaultValue={6} />
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              id="schedule-recipients"
              label="Recipients"
              required
              hint="Comma-separated emails"
            >
              <Input
                id="schedule-recipients"
                name="recipients"
                type="text"
                placeholder="office@school.test"
              />
            </FormField>
          </div>
          {error && (
            <p className="sm:col-span-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="sm:col-span-2 text-sm text-emerald-700" data-testid="schedule-created">
              {success}
            </p>
          )}
          <div className="sm:col-span-2">
            <Button
              type="submit"
              disabled={pending}
              title={pending ? 'Saving schedule' : undefined}
            >
              {pending ? 'Saving…' : 'Create schedule'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
