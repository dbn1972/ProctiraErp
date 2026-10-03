/**
 * Staff invoices (Server Component).
 */
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { FEE_LIST_PAGE_SIZE, listFeePlansResult, listInvoicesPageResult } from '@/lib/api/fees';
import {
  buildHref,
  PlatformPagination,
  readPage,
  readParam,
  type SearchParams,
} from '@/components/platform/PlatformSurfaceState';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { humanizeStatus } from '@/lib/status-label';
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStudentOptions } from '@/lib/load-entity-labels';
import { NewInvoiceForm } from '../_components/new-invoice-form';
import { ConcessionDialog } from '../_components/concession-dialog';
import { PayInvoiceStaffButton } from '../_components/pay-invoice-staff-button';
import { RefundDialog } from '../_components/refund-dialog';

import { getLocale } from 'next-intl/server';

import { formatAmount } from '../_components/format-amount';

export const dynamic = 'force-dynamic';

const INVOICE_STATUSES = ['open', 'overdue', 'paid', 'void', 'written_off'] as const;
export default async function FeesInvoicesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireSession();
  const locale = await getLocale();
  const params = (await searchParams) ?? {};
  const page = readPage(params);
  const statusParam = readParam(params, 'status');
  const status = INVOICE_STATUSES.find((s) => s === statusParam);
  // PRC-M477: one server-side page (<=50 rows) instead of the whole ledger.
  const [plansResult, invoicesResult, studentOptions] = await Promise.all([
    listFeePlansResult(),
    listInvoicesPageResult({ page, pageSize: FEE_LIST_PAGE_SIZE, status }),
    loadStudentOptions(),
  ]);
  const pageMeta = invoicesResult.ok
    ? {
        page: invoicesResult.meta?.page ?? page,
        pageSize: invoicesResult.meta?.pageSize ?? FEE_LIST_PAGE_SIZE,
        totalItems: invoicesResult.meta?.totalItems ?? invoicesResult.items.length,
        totalPages: invoicesResult.meta?.totalPages ?? 1,
      }
    : null;
  const plans = plansResult.ok ? plansResult.items : [];
  const invoices = invoicesResult.ok ? invoicesResult.items : [];
  const studentLabels = new Map(studentOptions.map((option) => [option.id, option.label]));
  const planLabels = new Map(plans.map((plan) => [plan.id, plan.name]));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fee invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Issue invoices to students; parents pay via the family portal (sandbox).
        </p>
      </div>

      <NewInvoiceForm plans={plans} studentOptions={studentOptions} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
          <CardDescription>
            {!invoicesResult.ok
              ? 'Invoices could not be loaded.'
              : (pageMeta?.totalItems ?? 0) === 0
                ? status
                  ? `No ${status} invoices.`
                  : 'No invoices yet.'
                : `${(pageMeta?.totalItems ?? invoices.length).toLocaleString()} invoice(s)${status ? ` (${status})` : ''}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <nav aria-label="Filter invoices by status" className="flex flex-wrap gap-2 text-sm">
            {[undefined, ...INVOICE_STATUSES].map((value) => (
              <Link
                key={value ?? 'all'}
                href={buildHref('/fees/invoices', { status: value })}
                aria-current={value === status ? 'page' : undefined}
                className={`rounded-md border px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  value === status ? 'border-primary bg-primary/10 font-medium' : 'border-input'
                }`}
              >
                {value ? humanizeStatus(value) : 'All'}
              </Link>
            ))}
          </nav>
          {!invoicesResult.ok ? (
            <ListLoadFailure
              kind={invoicesResult.kind}
              status={invoicesResult.status}
              returnTo="/fees/invoices"
            />
          ) : invoices.length === 0 ? (
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
                    {formatAmount(invoice.amountCents, invoice.currency, locale)} ·{' '}
                    {resolveEntityLabel(invoice.studentId, studentLabels, 'Student')} ·{' '}
                    {humanizeStatus(invoice.status)}
                    {invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ''}
                    {invoice.planId
                      ? ` · ${resolveEntityLabel(invoice.planId, planLabels, 'Plan')}`
                      : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {invoice.status === 'open' ? (
                      <PayInvoiceStaffButton invoiceId={invoice.id} />
                    ) : null}
                    {invoice.status === 'open' && invoice.structureId ? (
                      <ConcessionDialog
                        studentId={invoice.studentId}
                        structureId={invoice.structureId}
                        invoiceId={invoice.id}
                      />
                    ) : null}
                    {invoice.status === 'paid' ? (
                      <RefundDialog invoiceId={invoice.id} amountCents={invoice.amountCents} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {pageMeta ? (
            <PlatformPagination
              meta={pageMeta}
              hrefFor={(p) => buildHref('/fees/invoices', { status, page: p })}
              itemLabel="invoices"
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
