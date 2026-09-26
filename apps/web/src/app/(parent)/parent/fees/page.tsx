/**
 * Parent fees (Server Component) — invoices, instalment schedule, remaining balance (F3).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import {
  listInvoicesResult,
  listReceiptsResult,
  type FeeInstalment,
  type FeeInvoice,
  type FeeReceipt,
} from '@/lib/api/fees';
import { fetchList } from '@/lib/api/list-result';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import type { ListFailureKind } from '@/lib/api/list-result';
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStudentLabelsForIds } from '@/lib/load-entity-labels';
import { humanizeStatus } from '@/lib/status-label';
import { PayInvoiceButton } from './_components/pay-invoice-button';

export const dynamic = 'force-dynamic';

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
  }).format(cents / 100);
}

function remainingBalanceCents(invoice: FeeInvoice, receipts: FeeReceipt[]): number {
  if (invoice.status === 'paid' || invoice.status === 'void') return 0;
  const paid = receipts
    .filter((receipt) => receipt.invoiceId === invoice.id)
    .reduce((sum, receipt) => sum + receipt.amountCents, 0);
  return Math.max(0, invoice.amountCents - paid);
}

function dueDateForInstalment(invoice: FeeInvoice, instalment: FeeInstalment): Date {
  const base = invoice.dueAt
    ? new Date(invoice.dueAt)
    : invoice.createdAt
      ? new Date(invoice.createdAt)
      : new Date();
  // Structure offsets are relative to issue; first instalment uses the invoice due when present.
  if (instalment.sequence === 1 && invoice.dueAt) {
    return new Date(invoice.dueAt);
  }
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + instalment.dueOffsetDays);
  return d;
}

export default async function ParentFeesPage() {
  await requireSession();
  const [invoicesResult, receiptsResult] = await Promise.all([
    listInvoicesResult('parent'),
    listReceiptsResult('parent'),
  ]);
  if (!invoicesResult.ok) {
    return <ParentFeesFailure kind={invoicesResult.kind} status={invoicesResult.status} />;
  }
  if (!receiptsResult.ok) {
    return <ParentFeesFailure kind={receiptsResult.kind} status={receiptsResult.status} />;
  }
  const invoices = invoicesResult.items;
  const receipts = receiptsResult.items;
  const studentLabels = await loadStudentLabelsForIds(invoices.map((invoice) => invoice.studentId));

  const structureIds = [
    ...new Set(invoices.map((invoice) => invoice.structureId).filter((id): id is string => !!id)),
  ];
  const instalmentsByStructure = new Map<string, FeeInstalment[] | null>();
  await Promise.all(
    structureIds.map(async (structureId) => {
      // Staff `fees.read` is denied to parents. `scope=parent` uses fees.read.self.
      const parts = await fetchList<FeeInstalment>(
        `/fees/structures/${structureId}/instalments?scope=parent`,
        { next: { revalidate: 0 } },
      );
      instalmentsByStructure.set(structureId, parts.ok ? parts.items : null);
    }),
  );
  const hasVisibleSchedule = invoices.some((invoice) => {
    if (!invoice.structureId) return false;
    const parts = instalmentsByStructure.get(invoice.structureId);
    return parts == null || parts.length > 0;
  });

  const openRemaining = invoices.reduce(
    (sum, invoice) => sum + remainingBalanceCents(invoice, receipts),
    0,
  );
  const openCount = invoices.filter(
    (invoice) => remainingBalanceCents(invoice, receipts) > 0,
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fees</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See what is due, how instalments are scheduled, and what remains to pay. Online payment
            uses a test processor until your school connects a live payment provider.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Remaining balance</CardTitle>
          <CardDescription>
            Total still owed across open invoices for your linked children.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p
            className="text-2xl font-semibold tracking-tight"
            data-testid="parent-remaining-balance"
          >
            {formatAmount(openRemaining, 'INR')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {`${openCount} open invoice${openCount === 1 ? '' : 's'}`}
          </p>
        </CardContent>
      </Card>

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
              {invoices.map((invoice) => {
                const remaining = remainingBalanceCents(invoice, receipts);
                return (
                  <li
                    key={invoice.id}
                    className="py-3 first:pt-0 last:pb-0"
                    data-testid="parent-invoice-row"
                  >
                    <p className="text-sm font-medium text-foreground">{invoice.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Billed {formatAmount(invoice.amountCents, invoice.currency)} · Remaining{' '}
                      {formatAmount(remaining, invoice.currency)} ·{' '}
                      {resolveEntityLabel(invoice.studentId, studentLabels, 'Child')} ·{' '}
                      {humanizeStatus(invoice.status)}
                      {invoice.dueAt
                        ? ` · due ${new Date(invoice.dueAt).toLocaleDateString()}`
                        : ''}
                    </p>
                    {invoice.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{invoice.description}</p>
                    ) : null}
                    <PayInvoiceButton invoiceId={invoice.id} status={invoice.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instalment schedule</CardTitle>
          <CardDescription>
            Planned parts of fee structures linked to your invoices. Dates are guidance from the
            school schedule.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {structureIds.length === 0 || !hasVisibleSchedule ? (
            <p
              className="text-sm text-muted-foreground"
              role="status"
              data-testid="parent-instalments-empty"
            >
              No instalment schedule yet. When a fee is billed from a multi-part structure, the
              schedule appears here.
            </p>
          ) : (
            <ul className="space-y-4" role="list" data-testid="parent-instalment-schedule">
              {invoices
                .filter((invoice) => invoice.structureId)
                .map((invoice) => {
                  const parts = instalmentsByStructure.get(invoice.structureId!);
                  if (parts == null) {
                    return (
                      <li
                        key={`${invoice.id}-schedule`}
                        className="rounded-md border border-border p-3"
                        data-testid="parent-instalment-group"
                      >
                        <p className="text-sm font-medium text-foreground">{invoice.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground" role="status">
                          Instalment schedule could not be loaded for this invoice.
                        </p>
                      </li>
                    );
                  }
                  if (parts.length === 0) return null;
                  const remaining = remainingBalanceCents(invoice, receipts);
                  let covered = invoice.amountCents - remaining;
                  return (
                    <li
                      key={`${invoice.id}-schedule`}
                      className="rounded-md border border-border p-3"
                      data-testid="parent-instalment-group"
                    >
                      <p className="text-sm font-medium text-foreground">{invoice.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Remaining {formatAmount(remaining, invoice.currency)} of{' '}
                        {formatAmount(invoice.amountCents, invoice.currency)}
                      </p>
                      <ol className="mt-3 divide-y divide-border" role="list">
                        {parts
                          .slice()
                          .sort((a, b) => a.sequence - b.sequence)
                          .map((part) => {
                            const due = dueDateForInstalment(invoice, part);
                            const applied = Math.min(part.amountCents, Math.max(0, covered));
                            covered = Math.max(0, covered - part.amountCents);
                            const partRemaining = part.amountCents - applied;
                            const state =
                              partRemaining <= 0
                                ? 'Paid'
                                : applied > 0
                                  ? 'Part paid'
                                  : invoice.status === 'open'
                                    ? 'Upcoming'
                                    : humanizeStatus(invoice.status);
                            return (
                              <li
                                key={part.id}
                                className="py-2 first:pt-0 last:pb-0"
                                data-testid="parent-instalment-row"
                              >
                                <p className="text-sm text-foreground">
                                  {part.label || `Instalment ${part.sequence}`}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatAmount(part.amountCents, invoice.currency)} · due{' '}
                                  {due.toLocaleDateString()} · {state}
                                  {partRemaining > 0 && applied > 0
                                    ? ` · still ${formatAmount(partRemaining, invoice.currency)}`
                                    : ''}
                                </p>
                              </li>
                            );
                          })}
                      </ol>
                    </li>
                  );
                })}
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

function ParentFeesFailure({ kind, status }: { kind: ListFailureKind; status: number }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fees</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See what is due, how instalments are scheduled, and what remains to pay. Online payment
          uses a test processor until your school connects a live payment provider.
        </p>
      </div>
      <ListLoadFailure kind={kind} status={status} returnTo="/parent/fees" />
    </div>
  );
}
