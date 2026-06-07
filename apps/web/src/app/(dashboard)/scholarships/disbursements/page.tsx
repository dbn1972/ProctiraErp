/**
 * Scholarship disbursements list (Server Component).
 *
 * Validates: Requirement 11.1 — schedule and track scholarship disbursements.
 */
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
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

export default async function ScholarshipDisbursementsPage() {
  const disbursements = await listScholarshipDisbursements();

  return (
    <section aria-labelledby="disbursements-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/scholarships">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Scholarships
        </Link>
      </Button>

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
          <Button>
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            Schedule disbursement
          </Button>
        </div>
      </div>

      {disbursements.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No disbursements scheduled.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table aria-label="Disbursements">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Recipient</TableHead>
                  <TableHead className="font-semibold">Program</TableHead>
                  <TableHead className="font-semibold text-end">Amount</TableHead>
                  <TableHead className="font-semibold">Payment date</TableHead>
                  <TableHead className="font-semibold">Method</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disbursements.map((d) => (
                  <TableRow key={d.id} className="group">
                    <TableCell className="font-semibold text-foreground">
                      {d.applicantName}
                    </TableCell>
                    <TableCell>{d.programName}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {d.currency} {d.amount.toLocaleString()}
                    </TableCell>
                    <TableCell>{d.paymentDate}</TableCell>
                    <TableCell className="capitalize">
                      {d.paymentMethod.replace(/_/g, ' ').toLowerCase()}
                    </TableCell>
                    <TableCell>
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
