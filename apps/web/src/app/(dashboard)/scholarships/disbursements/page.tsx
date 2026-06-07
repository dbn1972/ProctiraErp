/**
 * Scholarship disbursements list (Server Component).
 *
 * Validates: Requirement 11.1 — schedule and track scholarship disbursements.
 */
import { Plus } from 'lucide-react';

import {
  Badge,
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

export const dynamic = 'force-dynamic';

export default async function ScholarshipDisbursementsPage() {
  const disbursements = await listScholarshipDisbursements();

  return (
    <section aria-labelledby="disbursements-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="disbursements-heading" className="text-2xl font-semibold tracking-tight">
            Disbursements
          </h1>
          <p className="text-sm text-muted-foreground">
            Schedule, track, and reconcile scholarship payments to recipients.
          </p>
        </div>
        <Button>
          <Plus className="me-2 h-4 w-4" aria-hidden="true" />
          Schedule disbursement
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All disbursements</CardTitle>
          <CardDescription>
            {disbursements.length.toLocaleString()} payment records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {disbursements.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No disbursements scheduled.
            </p>
          ) : (
            <Table aria-label="Disbursements">
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Payment date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disbursements.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.applicantName}</TableCell>
                    <TableCell>{d.programName}</TableCell>
                    <TableCell className="text-right">
                      {d.currency} {d.amount.toLocaleString()}
                    </TableCell>
                    <TableCell>{d.paymentDate}</TableCell>
                    <TableCell className="capitalize">
                      {d.paymentMethod.replace(/_/g, ' ').toLowerCase()}
                    </TableCell>
                    <TableCell>
                      <DisbursementStatus status={d.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function DisbursementStatus({ status }: { status: ScholarshipDisbursement['status'] }) {
  switch (status) {
    case 'PROCESSED':
      return <Badge variant="success">Processed</Badge>;
    case 'FAILED':
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="secondary">Scheduled</Badge>;
  }
}
