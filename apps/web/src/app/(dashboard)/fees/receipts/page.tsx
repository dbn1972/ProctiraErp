/**
 * Staff receipts (Server Component).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { FEE_LIST_PAGE_SIZE, listInvoicesResult, listReceiptsPageResult } from '@/lib/api/fees';
import {
  buildHref,
  PlatformPagination,
  readPage,
  type SearchParams,
} from '@/components/platform/PlatformSurfaceState';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { resolveEntityLabel } from '@/lib/entity-label';

import { getLocale } from 'next-intl/server';

import { formatAmount } from '../_components/format-amount';

export const dynamic = 'force-dynamic';

export default async function FeesReceiptsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireSession();
  const locale = await getLocale();
  const page = readPage((await searchParams) ?? {});
  // PRC-M477: one server-side page of receipts instead of the whole history.
  const [receiptsResult, invoicesResult] = await Promise.all([
    listReceiptsPageResult({ page, pageSize: FEE_LIST_PAGE_SIZE }),
    listInvoicesResult('staff'),
  ]);
  if (!receiptsResult.ok) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fee receipts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Issued after sandbox (or recorded) payment. Live PSP waived for this slice.
          </p>
        </div>
        <ListLoadFailure
          kind={receiptsResult.kind}
          status={receiptsResult.status}
          returnTo="/fees/receipts"
        />
      </div>
    );
  }
  const receipts = receiptsResult.items;
  const pageMeta = {
    page: receiptsResult.meta?.page ?? page,
    pageSize: receiptsResult.meta?.pageSize ?? FEE_LIST_PAGE_SIZE,
    totalItems: receiptsResult.meta?.totalItems ?? receipts.length,
    totalPages: receiptsResult.meta?.totalPages ?? 1,
  };
  const invoices = invoicesResult.ok ? invoicesResult.items : [];
  const invoiceLabels = new Map(
    invoices.map((invoice) => [
      invoice.id,
      invoice.invoiceNumber?.trim() || invoice.title || 'Invoice',
    ]),
  );

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
            {pageMeta.totalItems === 0
              ? 'No receipts yet.'
              : `${pageMeta.totalItems.toLocaleString()} receipt(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
                    {formatAmount(receipt.amountCents, receipt.currency, locale)} ·{' '}
                    {resolveEntityLabel(receipt.invoiceId, invoiceLabels, 'Invoice')} ·{' '}
                    {new Date(receipt.issuedAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PlatformPagination
            meta={pageMeta}
            hrefFor={(p) => buildHref('/fees/receipts', { page: p })}
            itemLabel="receipts"
          />
        </CardContent>
      </Card>
    </div>
  );
}
