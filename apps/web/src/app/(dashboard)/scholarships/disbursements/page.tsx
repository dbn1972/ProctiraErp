/**
 * Scholarship disbursements list (Server Component).
 *
 * Layout per redesign/web/scholarships-disbursements.html:
 *  - Page head with New batch CTA
 *  - KPI cards (disbursed total, success rate, failed, scheduled)
 *  - Optional failed-transfer alert
 *  - Payment records table with status pills
 *
 * Validates: Requirement 11.1 — schedule and track scholarship disbursements.
 */
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Wallet,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  listScholarshipDisbursements,
  type ScholarshipDisbursement,
} from '@/lib/api/scholarships';
import { cn } from '@/lib/utils';

import { RetryFailedTransfersButton } from '../_components/retry-failed-transfers-button';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<ScholarshipDisbursement['status'], string> = {
  SCHEDULED: 'Scheduled',
  PROCESSED: 'Processed',
  FAILED: 'Failed',
};

const STATUS_COLOURS: Record<ScholarshipDisbursement['status'], string> = {
  PROCESSED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  SCHEDULED: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
  FAILED: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function ScholarshipDisbursementsPage() {
  const disbursements = await listScholarshipDisbursements();

  const processed = disbursements.filter((d) => d.status === 'PROCESSED');
  const failed = disbursements.filter((d) => d.status === 'FAILED');
  const scheduled = disbursements.filter((d) => d.status === 'SCHEDULED');
  const currency = disbursements[0]?.currency ?? 'INR';
  const disbursedTotal = processed.reduce((sum, d) => sum + d.amount, 0);
  const failedTotal = failed.reduce((sum, d) => sum + d.amount, 0);
  const settled = processed.length + failed.length;
  const successRate =
    settled > 0 ? ((processed.length / settled) * 100).toFixed(1) : null;

  return (
    <section aria-labelledby="disbursements-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="disbursements-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Disbursements
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            DBT payments to student bank accounts. Each batch is reconciled against PFMS within 48
            hours of processing.
            {disbursements.length > 0
              ? ` ${disbursements.length.toLocaleString()} payment records.`
              : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New batch
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          label="Disbursed"
          value={
            processed.length > 0 ? formatMoney(disbursedTotal, currency) : '—'
          }
          foot={`${processed.length.toLocaleString()} processed`}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Transfer success rate"
          value={successRate !== null ? `${successRate}%` : '—'}
          foot={
            settled > 0
              ? `${processed.length.toLocaleString()} of ${settled.toLocaleString()} settled`
              : 'No settled transfers yet'
          }
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
          label="Failed transfers"
          value={failed.length.toLocaleString()}
          foot={
            failed.length > 0
              ? `${formatMoney(failedTotal, currency)} pending retry`
              : 'No failed transfers'
          }
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Scheduled"
          value={scheduled.length.toLocaleString()}
          foot="Awaiting processing"
        />
      </div>

      {failed.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 sm:flex-row sm:items-center dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {failed.length.toLocaleString()} failed transfer
              {failed.length === 1 ? '' : 's'}
            </p>
            <p className="text-xs opacity-90">
              {formatMoney(failedTotal, currency)} needs retry. Confirm bank details before
              reprocessing.
            </p>
          </div>
          <RetryFailedTransfersButton failedIds={failed.map((d) => d.id)} />
        </div>
      ) : null}

      {disbursements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No disbursements scheduled.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payment records</CardTitle>
            <CardDescription>
              Individual DBT transfers · {disbursements.length.toLocaleString()} records
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table aria-label="Disbursements">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="ps-4 font-semibold">Recipient</TableHead>
                    <TableHead className="font-semibold">Program</TableHead>
                    <TableHead className="font-semibold text-end">Amount</TableHead>
                    <TableHead className="font-semibold">Payment date</TableHead>
                    <TableHead className="font-semibold">Method</TableHead>
                    <TableHead className="pe-4 font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disbursements.map((d) => (
                    <TableRow key={d.id} className="group">
                      <TableCell className="ps-4 font-semibold text-foreground">
                        {d.applicantName}
                        <p className="font-mono text-[11px] font-normal text-muted-foreground">
                          {d.applicationId}
                        </p>
                      </TableCell>
                      <TableCell>{d.programName}</TableCell>
                      <TableCell className="text-end font-semibold tabular-nums">
                        {formatMoney(d.amount, d.currency)}
                      </TableCell>
                      <TableCell>{formatDate(d.paymentDate)}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {d.paymentMethod === 'BANK_TRANSFER'
                            ? 'DBT'
                            : d.paymentMethod.replace(/_/g, ' ')}
                        </span>
                      </TableCell>
                      <TableCell className="pe-4">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                            STATUS_COLOURS[d.status],
                          )}
                        >
                          {STATUS_LABELS[d.status]}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              Showing{' '}
              <span className="font-semibold text-foreground">1–{disbursements.length}</span> of{' '}
              <span className="font-semibold text-foreground">{disbursements.length}</span> records
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function KpiCard({
  icon,
  iconClass,
  label,
  value,
  foot,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  foot?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              iconClass,
            )}
          >
            {icon}
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
          {value}
        </div>
        {foot ? <p className="mt-1 text-xs text-muted-foreground">{foot}</p> : null}
      </CardContent>
    </Card>
  );
}
