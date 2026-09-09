/**
 * Parent fees (Server Component).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listInvoices, listReceipts } from '@/lib/api/fees';
import { formatAmount, PayInvoiceButton } from './_components/pay-invoice-button';

export const dynamic = 'force-dynamic';

export default async function ParentFeesPage() {
  await requireSession();
  const [invoices, receipts] = await Promise.all([listInvoices('parent'), listReceipts('parent')]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fees</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View school fee invoices and pay them when they are issued. Payments use the sandbox
            processor until a live PSP is connected.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
          <CardDescription>
            {invoices.length === 0
              ? 'Nothing due right now.'
              : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No fee invoices right now. When your school issues one, it will appear here for
              payment.
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Receipts</CardTitle>
          <CardDescription>
            {receipts.length === 0
              ? 'No receipts yet.'
              : `${receipts.length} receipt${receipts.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              After you pay an invoice, a receipt number appears here.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="parent-receipt-row"
                >
                  <p className="text-sm font-medium text-foreground">{receipt.receiptNumber}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAmount(receipt.amountCents, receipt.currency)} ·{' '}
                    {new Date(receipt.issuedAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
