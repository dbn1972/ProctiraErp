'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button, FormField, Textarea } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { StaffImportReport } from '@/lib/api/staff';

import { commitImportAction, dryRunImportAction } from '../hr-actions';

export function StaffImportForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState(
    'firstName,lastName,dateOfBirth,identityNumber,contactPhone,position,contactEmail,contractType,startDate,endDate,salaryBand\n',
  );
  const [report, setReport] = useState<StaffImportReport | null>(null);

  function run(kind: 'dry' | 'commit') {
    startTransition(async () => {
      setError(null);
      const result =
        kind === 'dry'
          ? await dryRunImportAction(csv, 'staff.csv')
          : await commitImportAction(csv, 'staff.csv');
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      setReport(result.report ?? null);
      if (kind === 'commit') router.refresh();
    });
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ''));
      setReport(null);
    };
    reader.readAsText(file);
  }

  return (
    <div
      className="space-y-4"
      data-testid="staff-import-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <p className="text-sm text-muted-foreground">
        CSV only. Excel (.xlsx) is not parsed in this slice — save the first sheet as CSV.
      </p>
      <FormField id="staff-csv-file" label="CSV file">
        <input
          id="staff-csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          disabled={!hydrated || pending}
          className="block min-h-11 w-full text-sm file:mr-4 file:min-h-11 file:rounded-md file:border file:border-input file:bg-background file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground"
        />
      </FormField>
      <FormField id="staff-csv" label="CSV text" required>
        <Textarea
          id="staff-csv"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={10}
          disabled={!hydrated || pending}
        />
      </FormField>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {report ? (
        <div
          className="rounded-md border border-border p-3 text-sm"
          data-testid="staff-import-report"
        >
          <p>
            {report.rows} row(s) · {report.valid} valid
            {typeof report.created === 'number' ? ` · ${report.created} created` : ''}
          </p>
          {report.errors.length > 0 ? (
            <ul className="mt-2 list-disc ps-5 text-destructive">
              {report.errors.map((err, i) => (
                <li key={`${err.row}-${i}`}>
                  Row {err.row}
                  {err.field ? ` (${err.field})` : ''}: {err.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">No row errors.</p>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => run('dry')}
          disabled={!hydrated || pending}
        >
          {pending ? 'Working…' : 'Dry-run'}
        </Button>
        <Button type="button" onClick={() => run('commit')} disabled={!hydrated || pending}>
          {pending ? 'Working…' : 'Commit import'}
        </Button>
      </div>
    </div>
  );
}
