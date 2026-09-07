/**
 * Parent fees (Server Component).
 */
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listInvoices } from '@/lib/api/parent-portal';
import { formatAmount, PayInvoiceButton } from './_components/pay-invoice-button';

export const dynamic = 'force-dynamic';

export default async function ParentFeesPage() {
  await requireSession();
  const invoices = await listInvoices();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fees</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invoices via GET `/parent-portal/fees/invoices` · pay via POST
            `/parent-portal/fees/invoices/:id/pay`.
          </p>
        </div>
        <Button asChild variant="outline" className="min-h-12">
          <Link href="/parent">Back to home</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
          <CardDescription>
            {invoices.length === 0
              ? 'No invoices.'
              : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No invoices.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {invoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="parent-invoice-row"
                >
                  <p className="text-sm font-medium text-foreground">{invoice.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAmount(invoice.amountCents, invoice.currency)} · Student{' '}
                    {invoice.studentId.slice(0, 8)}… · {invoice.status}
                    {invoice.dueAt ? ` · due ${new Date(invoice.dueAt).toLocaleDateString()}` : ''}
                  </p>
                  {invoice.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{invoice.description}</p>
                  ) : null}
                  <PayInvoiceButton invoiceId={invoice.id} status={invoice.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
