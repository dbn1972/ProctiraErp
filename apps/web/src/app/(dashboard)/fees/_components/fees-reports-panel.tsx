'use client';

import { useLocale } from 'next-intl';

import type { ReactNode } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { DuesReport } from '@/lib/api/fees';
import { resolveEntityLabel } from '@/lib/entity-label';
import { humanizeStatus } from '@/lib/status-label';

function formatAmount(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function FeesReportsPanel({
  report,
  header,
  classLabels = {},
}: {
  report: DuesReport;
  header: ReactNode;
  classLabels?: Record<string, string>;
}) {
  const locale = useLocale();
  const hydrated = useHydrated();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {header}
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
                  <p className="text-sm font-medium text-foreground">
                    {row.classId === 'unassigned'
                      ? 'Unassigned'
                      : resolveEntityLabel(row.classId, classLabels, 'Class')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Open {row.openCount} ({formatAmount(row.openCents, locale)}) · Overdue{' '}
                    {row.overdueCount} ({formatAmount(row.overdueCents, locale)})
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
                    {humanizeStatus(row.status)}: {row.count} ·{' '}
                    {formatAmount(row.amountCents, locale)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reconciliation</CardTitle>
          <CardDescription>
            Bank/PSP CSV match and exception triage moved to the dedicated reconciliation console.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild data-testid="open-reconciliation-from-reports">
            <a href="/fees/reconciliation">Open reconciliation</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
