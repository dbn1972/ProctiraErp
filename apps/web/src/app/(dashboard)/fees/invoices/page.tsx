/**
 * Staff invoices (Server Component).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listFeePlansResult, listInvoicesResult } from '@/lib/api/fees';
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

export default async function FeesInvoicesPage() {
  await requireSession();
  const locale = await getLocale();
  const [plansResult, invoicesResult, studentOptions] = await Promise.all([
    listFeePlansResult(),
    listInvoicesResult('staff'),
    loadStudentOptions(),
  ]);
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
              : invoices.length === 0
                ? 'No invoices yet.'
                : `${invoices.length} invoice(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
