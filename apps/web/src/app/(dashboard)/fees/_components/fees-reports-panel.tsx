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
  Textarea,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import { importReconciliationAction } from '@/lib/fees/actions';
import type { DuesReport } from '@/lib/api/fees';

function formatAmount(cents: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function FeesReportsPanel({ report }: { report: DuesReport }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  function onImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      setSummary(null);
      const result = await importReconciliationAction({
        csv: String(fd.get('csv') ?? ''),
        filename: 'staff-import.csv',
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSummary(`Matched ${result.data.matched}, unmatched ${result.data.unmatched}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fee reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dues by class and status, plus bank reconciliation CSV import.
          </p>
        </div>
        <Button asChild data-testid="download-dues-csv" data-hydrated={hydrated ? 'true' : 'false'}>
          <a href="/api/fees/reports/dues">Download dues CSV</a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dues by class</CardTitle>
          <CardDescription>As of {new Date(report.asOf).toLocaleString()}</CardDescription>
        </CardHeader>
        <CardContent>
          {report.byClass.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid="dues-empty">
              No open dues.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {report.byClass.map((row) => (
                <li key={row.classId} className="py-2" data-testid="dues-class-row">
                  <p className="text-sm font-medium text-foreground">Class {row.classId.slice(0, 8)}…</p>
                  <p className="text-xs text-muted-foreground">
                    Open {row.openCount} ({formatAmount(row.openCents)}) · Overdue {row.overdueCount} (
                    {formatAmount(row.overdueCents)})
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By status</CardTitle>
        </CardHeader>
        <CardContent>
          {report.byStatus.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No invoices.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {report.byStatus.map((row) => (
                <li key={row.status} className="py-2" data-testid="dues-status-row">
                  <p className="text-sm text-foreground">
                    {row.status}: {row.count} · {formatAmount(row.amountCents)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reconciliation import</CardTitle>
          <CardDescription>CSV columns: invoiceNumber,amountCents</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onImport}
            className="space-y-3"
            data-testid="recon-import-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <FormField id="recon-csv" label="CSV" required>
              <Textarea id="recon-csv" name="csv" rows={6} required disabled={!hydrated || pending} />
            </FormField>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {summary ? (
              <p className="text-sm text-muted-foreground" role="status" data-testid="recon-summary">
                {summary}
              </p>
            ) : null}
            <Button type="submit" disabled={!hydrated || pending} data-testid="submit-recon">
              {pending ? 'Importing…' : 'Import'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
