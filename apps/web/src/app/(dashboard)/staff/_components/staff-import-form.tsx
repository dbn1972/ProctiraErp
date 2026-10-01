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
  // CSV text the last successful dry-run validated. Commit is only allowed for
  // exactly that text, so editing after a dry-run re-disables Commit (PRC-L246).
  const [dryRunCsv, setDryRunCsv] = useState<string | null>(null);
  const [dryRunErrors, setDryRunErrors] = useState(0);
  const [acceptValidOnly, setAcceptValidOnly] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'partial'; text: string } | null>(null);
  const dryRunCurrent = dryRunCsv !== null && dryRunCsv === csv;
  const canCommit = dryRunCurrent && (dryRunErrors === 0 || acceptValidOnly);

  function resetDryRun() {
    setDryRunCsv(null);
    setDryRunErrors(0);
    setAcceptValidOnly(false);
  }

  function run(kind: 'dry' | 'commit') {
    if (kind === 'commit' && !canCommit) return;
    const submitted = csv;
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const result =
        kind === 'dry'
          ? await dryRunImportAction(submitted, 'staff.csv')
          : await commitImportAction(submitted, 'staff.csv');
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      setReport(result.report ?? null);
      if (kind === 'dry') {
        setDryRunCsv(submitted);
        setDryRunErrors(result.report?.errors.length ?? 0);
        setAcceptValidOnly(false);
        return;
      }
      resetDryRun();
      setNotice({
        kind: result.status === 'partial' ? 'partial' : 'success',
        text: result.message ?? '',
      });
      router.refresh();
    });
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ''));
      setReport(null);
      resetDryRun();
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
          onChange={(e) => {
            setCsv(e.target.value);
            setAcceptValidOnly(false);
          }}
          rows={10}
          disabled={!hydrated || pending}
        />
      </FormField>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          data-testid="staff-import-notice"
          data-kind={notice.kind}
          className={
            notice.kind === 'partial'
              ? 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800'
              : 'rounded-md border border-border p-3 text-sm text-foreground'
          }
        >
          {notice.kind === 'partial' ? 'Partially imported: ' : ''}
          {notice.text}
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
      {dryRunCurrent && dryRunErrors > 0 ? (
        <label
          className="flex min-h-11 items-center gap-2 text-sm"
          htmlFor="staff-import-valid-only"
        >
          <input
            id="staff-import-valid-only"
            type="checkbox"
            className="h-5 w-5"
            checked={acceptValidOnly}
            onChange={(e) => setAcceptValidOnly(e.target.checked)}
            disabled={!hydrated || pending}
          />
          Commit valid rows only and skip the {dryRunErrors} row error(s)
        </label>
      ) : null}
      {!dryRunCurrent ? (
        <p id="staff-import-commit-hint" className="text-sm text-muted-foreground">
          Run a dry-run of the current CSV before committing.
        </p>
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
        <Button
          type="button"
          onClick={() => run('commit')}
          disabled={!hydrated || pending || !canCommit}
          aria-describedby={!dryRunCurrent ? 'staff-import-commit-hint' : undefined}
        >
          {pending ? 'Working…' : 'Commit import'}
        </Button>
      </div>
    </div>
  );
}
