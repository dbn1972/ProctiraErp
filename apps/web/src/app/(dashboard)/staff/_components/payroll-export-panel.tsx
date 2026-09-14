'use client';

import { useState, useTransition } from 'react';

import { Button, FormField, Input } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import { downloadCsv } from '@/lib/download';
import type { PayrollExport } from '@/lib/api/staff';

import { exportPayrollAction } from '../hr-actions';

function defaultMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function PayrollExportPanel({ initial }: { initial: PayrollExport | null }) {
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [month, setMonth] = useState(initial?.month ?? defaultMonth());
  const [error, setError] = useState<string | null>(null);
  const [payroll, setPayroll] = useState<PayrollExport | null>(initial);

  function onExport() {
    startTransition(async () => {
      setError(null);
      const result = await exportPayrollAction(month);
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      setPayroll(result.payroll ?? null);
    });
  }

  function onDownload() {
    if (!payroll) return;
    downloadCsv(
      payroll.filename,
      [
        'staffId',
        'name',
        'salaryBand',
        'daysPresent',
        'leaveDays',
        'absentDays',
        'grossCents',
        'deductionsCents',
        'netCents',
        'payableDays',
      ],
      payroll.rows.map((row) => [
        row.staffId,
        row.name,
        row.salaryBand,
        row.daysPresent,
        row.leaveDays,
        row.absentDays,
        row.grossCents,
        row.deductionsCents,
        row.netCents,
        row.payableDays,
      ]),
    );
  }

  return (
    <div
      className="space-y-4"
      data-testid="staff-payroll-panel"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-end gap-2">
        <FormField id="payroll-month" label="Month">
          <Input
            id="payroll-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={!hydrated || pending}
          />
        </FormField>
        <Button type="button" onClick={onExport} disabled={!hydrated || pending}>
          {pending ? 'Exporting…' : 'Build export'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDownload}
          disabled={!hydrated || pending || !payroll}
        >
          Download CSV
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {payroll ? (
        payroll.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            No staff rows for {payroll.month}.
          </p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {payroll.rows.map((row) => (
              <li key={row.staffId} className="py-2 text-sm" data-testid="staff-payroll-row">
                {row.name} · band {row.salaryBand || '—'} · present {row.daysPresent} · leave{' '}
                {row.leaveDays} · payable {row.payableDays}
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          Choose a month and build the export. Deductions are a placeholder (0).
        </p>
      )}
    </div>
  );
}
