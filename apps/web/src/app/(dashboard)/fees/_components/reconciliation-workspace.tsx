'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
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
  Textarea,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import { importReconciliationAction, resolveReconExceptionAction } from '@/lib/fees/actions';
import type { FeeReconciliationBatch, FeeReconciliationRow } from '@/lib/api/fees';

function formatAmount(cents: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function ReconciliationWorkspace({
  batches,
  initialBatchId,
  initialRows,
}: {
  batches: FeeReconciliationBatch[];
  initialBatchId: string | null;
  initialRows: FeeReconciliationRow[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(initialBatchId);
  const [rows, setRows] = useState(initialRows);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvePendingId, setResolvePendingId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedBatchId(initialBatchId);
    setRows(initialRows);
  }, [initialBatchId, initialRows]);

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );

  const matchedRows = rows.filter((row) => row.matched);
  const exceptionRows = rows.filter((row) => !row.matched);

  function onImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      setSummary(null);
      const result = await importReconciliationAction({
        csv: String(fd.get('csv') ?? ''),
        filename: String(fd.get('filename') ?? '').trim() || 'staff-import.csv',
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSummary(
        `Imported batch ${result.data.batchId.slice(0, 8)}… — matched ${result.data.matched}, exceptions ${result.data.unmatched}`,
      );
      setSelectedBatchId(result.data.batchId);
      router.push(`/fees/reconciliation?batch=${result.data.batchId}`);
      router.refresh();
    });
  }

  function onSelectBatch(batchId: string) {
    setSelectedBatchId(batchId);
    router.push(`/fees/reconciliation?batch=${batchId}`);
    router.refresh();
  }

  function onResolve(event: React.FormEvent<HTMLFormElement>, rowId: string) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setResolveError(null);
      setResolvePendingId(rowId);
      const result = await resolveReconExceptionAction({
        rowId,
        status: String(fd.get('status') ?? 'resolved') as 'resolved' | 'ignored',
        resolutionNote: String(fd.get('resolutionNote') ?? ''),
      });
      setResolvePendingId(null);
      if (!result.success) {
        setResolveError(result.error);
        return;
      }
      setRows((prev) => prev.map((row) => (row.id === rowId ? result.data : row)));
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import bank / PSP CSV</CardTitle>
          <CardDescription>
            Columns: <code className="text-xs">invoiceNumber,amountCents</code>. Creates a batch
            with match and exception rows plus an import audit (who / when).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onImport}
            className="space-y-3"
            data-testid="recon-import-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            aria-busy={pending}
          >
            <FormField id="recon-filename" label="Filename">
              <Input
                id="recon-filename"
                name="filename"
                placeholder="bank-clearing.csv"
                disabled={!hydrated || pending}
                autoComplete="off"
              />
            </FormField>
            <FormField id="recon-csv" label="CSV" required>
              <Textarea
                id="recon-csv"
                name="csv"
                rows={6}
                required
                disabled={!hydrated || pending}
              />
            </FormField>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {summary ? (
              <p
                className="text-sm text-muted-foreground"
                role="status"
                data-testid="recon-summary"
              >
                {summary}
              </p>
            ) : null}
            <Button type="submit" disabled={!hydrated || pending} data-testid="submit-recon">
              {pending && !resolvePendingId ? 'Importing…' : 'Import CSV'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import audit</CardTitle>
          <CardDescription>
            Recent reconciliation batches for this school. Select a batch to triage matches and
            exceptions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              role="status"
              data-testid="recon-batches-empty"
            >
              No imports yet. Paste a clearing CSV above to create the first batch.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list" data-testid="recon-batch-list">
              {batches.map((batch) => {
                const selected = batch.id === selectedBatchId;
                return (
                  <li key={batch.id} className="py-2 first:pt-0 last:pb-0">
                    <button
                      type="button"
                      className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors ${
                        selected ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/60'
                      }`}
                      data-testid="recon-batch-row"
                      data-batch-id={batch.id}
                      aria-pressed={selected}
                      onClick={() => onSelectBatch(batch.id)}
                    >
                      <span className="font-medium">
                        {batch.filename || 'import.csv'} · matched {batch.matchedCount} · exceptions{' '}
                        {batch.unmatchedCount}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {new Date(batch.createdAt).toLocaleString()}
                        {batch.createdBy ? ` · by ${batch.createdBy}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {selectedBatch ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Matches</CardTitle>
              <CardDescription>
                Rows that cleared against an invoice for the same amount.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {matchedRows.length === 0 ? (
                <p className="text-sm text-muted-foreground" role="status">
                  No matches in this batch.
                </p>
              ) : (
                <ul className="divide-y divide-border" role="list" data-testid="recon-match-list">
                  {matchedRows.map((row) => (
                    <li key={row.id} className="py-2" data-testid="recon-match-row">
                      <p className="text-sm font-medium text-foreground">{row.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatAmount(row.amountCents)}
                        {row.invoiceId ? ` · invoice ${row.invoiceId.slice(0, 8)}…` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Exceptions</CardTitle>
              <CardDescription>
                Unmatched or amount-mismatch rows. Resolve or ignore with a note for the audit
                trail.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {resolveError ? (
                <p className="text-sm text-destructive" role="alert">
                  {resolveError}
                </p>
              ) : null}
              {exceptionRows.length === 0 ? (
                <p
                  className="text-sm text-muted-foreground"
                  role="status"
                  data-testid="recon-exceptions-empty"
                >
                  No exceptions in this batch.
                </p>
              ) : (
                <ul className="space-y-4" role="list" data-testid="recon-exception-list">
                  {exceptionRows.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-md border border-border p-3"
                      data-testid="recon-exception-row"
                      data-exception-status={row.exceptionStatus}
                    >
                      <p className="text-sm font-medium text-foreground">{row.invoiceNumber}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatAmount(row.amountCents)}
                        {row.note ? ` · ${row.note}` : ''} · {row.exceptionStatus}
                      </p>
                      {row.exceptionStatus === 'open' ? (
                        <form
                          className="mt-3 space-y-2"
                          onSubmit={(event) => onResolve(event, row.id)}
                          data-testid="recon-resolve-form"
                        >
                          <FormField id={`recon-status-${row.id}`} label="Action" required>
                            <select
                              id={`recon-status-${row.id}`}
                              name="status"
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              disabled={!hydrated || pending}
                              defaultValue="resolved"
                            >
                              <option value="resolved">Resolve</option>
                              <option value="ignored">Ignore</option>
                            </select>
                          </FormField>
                          <FormField id={`recon-note-${row.id}`} label="Resolution note" required>
                            <Textarea
                              id={`recon-note-${row.id}`}
                              name="resolutionNote"
                              rows={2}
                              required
                              disabled={!hydrated || pending}
                            />
                          </FormField>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={!hydrated || pending}
                            data-testid="submit-recon-resolve"
                          >
                            {resolvePendingId === row.id ? 'Saving…' : 'Record resolution'}
                          </Button>
                        </form>
                      ) : (
                        <p
                          className="mt-2 text-xs text-muted-foreground"
                          data-testid="recon-exception-audit"
                        >
                          Closed {row.resolvedAt ? new Date(row.resolvedAt).toLocaleString() : ''}
                          {row.resolvedBy ? ` by ${row.resolvedBy}` : ''}
                          {row.resolutionNote ? ` — ${row.resolutionNote}` : ''}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
