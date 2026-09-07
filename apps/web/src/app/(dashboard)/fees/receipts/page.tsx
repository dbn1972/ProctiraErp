/**
 * Staff receipts (Server Component).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listReceipts } from '@/lib/api/parent-portal';

export const dynamic = 'force-dynamic';

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default async function FeesReceiptsPage() {
  await requireSession();
  const receipts = await listReceipts('staff');

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fee receipts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Issued after sandbox (or recorded) payment. Live PSP waived for this slice.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Receipts</CardTitle>
          <CardDescription>
            {receipts.length === 0 ? 'No receipts yet.' : `${receipts.length} receipt(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Receipts appear when a parent completes sandbox payment on an open invoice.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="fee-receipt-row"
                >
                  <p className="text-sm font-medium text-foreground">{receipt.receiptNumber}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAmount(receipt.amountCents, receipt.currency)} · invoice{' '}
                    {receipt.invoiceId.slice(0, 8)}… · {new Date(receipt.issuedAt).toLocaleString()}
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
