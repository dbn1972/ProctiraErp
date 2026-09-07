/**
 * Staff invoices (Server Component).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listFeePlans, listInvoices } from '@/lib/api/parent-portal';
import { NewInvoiceForm } from '../_components/new-invoice-form';

export const dynamic = 'force-dynamic';

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default async function FeesInvoicesPage() {
  await requireSession();
  const [plans, invoices] = await Promise.all([listFeePlans(), listInvoices('staff')]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fee invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Issue invoices to students; parents pay via the family portal (sandbox).
        </p>
      </div>

      <NewInvoiceForm plans={plans} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
          <CardDescription>
            {invoices.length === 0 ? 'No invoices yet.' : `${invoices.length} invoice(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Issue an invoice from a plan or ad-hoc amount.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {invoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="fee-invoice-row"
                >
                  <p className="text-sm font-medium text-foreground">{invoice.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAmount(invoice.amountCents, invoice.currency)} · Student{' '}
                    {invoice.studentId.slice(0, 8)}… · {invoice.status}
                    {invoice.planId ? ` · plan ${invoice.planId.slice(0, 8)}…` : ''}
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
