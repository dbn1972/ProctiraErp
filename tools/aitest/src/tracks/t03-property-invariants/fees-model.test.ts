import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ViolationLog } from './core.js';
import {
  accountBalances,
  checkFeesSnapshot,
  emptyFeesModel,
  expectedDiscount,
  expectedInstalments,
  FEES_INVARIANTS,
  unbalancedJournals,
  type FeesModel,
  type FeesSnapshot,
  type LedgerRow,
} from './fees-model.js';

const known = new Set(FEES_INVARIANTS.map((i) => i.id));
const leg = (
  journalId: string,
  account: LedgerRow['account'],
  side: LedgerRow['side'],
  amount: number,
  invoiceId = 'inv-1',
): LedgerRow => ({ journalId, invoiceId, account, side, amount });

function emptySnapshot(): FeesSnapshot {
  return {
    ledger: [],
    invoices: [],
    payments: [],
    receipts: [],
    refunds: [],
    creditNotes: [],
    writeOffs: [],
    concessions: [],
    instalments: [],
    structures: [],
    reconRows: [],
  };
}

/** Invoice of 1000, paid 600, refunded 100: issue, pay, refund journals. */
function paidScenario(): { m: FeesModel; s: FeesSnapshot } {
  const m = emptyFeesModel();
  m.invoices.push({
    id: 'inv-1',
    number: 'INV-1',
    kind: 'adhoc',
    structureId: null,
    issued: 1000,
    face: 1000,
    status: 'open',
    payments: [{ id: 'pay-1', amount: 600, refunded: 100 }],
  });
  const s = emptySnapshot();
  s.ledger = [
    leg('j1', 'accounts_receivable', 'debit', 1000),
    leg('j1', 'fee_revenue', 'credit', 1000),
    leg('j2', 'cash', 'debit', 600),
    leg('j2', 'accounts_receivable', 'credit', 600),
    leg('j3', 'fee_revenue', 'debit', 100),
    leg('j3', 'cash', 'credit', 100),
  ];
  s.invoices = [{ id: 'inv-1', face: 1000, status: 'open', structureId: null }];
  s.payments = [{ id: 'pay-1', invoiceId: 'inv-1', amount: 600, status: 'succeeded' }];
  s.receipts = [{ paymentId: 'pay-1', invoiceId: 'inv-1', amount: 600 }];
  s.refunds = [{ paymentId: 'pay-1', invoiceId: 'inv-1', amount: 100, status: 'posted' }];
  return { m, s };
}

describe('fees model invariants', () => {
  it('a balanced, consistent ledger passes every invariant', () => {
    const { m, s } = paidScenario();
    const log = new ViolationLog(known);
    checkFeesSnapshot(log, m, s);
    expect([...log.violations.keys()]).toEqual([]);
    expect(accountBalances(s.ledger).get('inv-1')).toEqual({
      accounts_receivable: 400,
      cash: 500,
      fee_revenue: -900,
      bad_debt_expense: 0,
    });
  });

  it('flags an unbalanced journal and a broken trial balance', () => {
    const { m, s } = paidScenario();
    s.ledger.push(leg('j4', 'cash', 'debit', 50));
    expect(unbalancedJournals(s.ledger)).toEqual([{ journalId: 'j4', debit: 50, credit: 0 }]);
    const log = new ViolationLog(known);
    checkFeesSnapshot(log, m, s);
    expect(log.violations.get('ledger-balanced')?.count).toBe(2);
    expect(log.violations.has('cash-equals-net-collected')).toBe(true);
  });

  it('flags a void invoice that still carries receivable and revenue', () => {
    const { m, s } = paidScenario();
    s.invoices[0]!.status = 'void';
    m.invoices[0]!.status = 'void';
    const log = new ViolationLog(known);
    checkFeesSnapshot(log, m, s);
    expect(log.violations.get('ar-equals-outstanding')?.firstDetail).toMatch(
      /void invoice owes nothing/,
    );
    expect(log.violations.has('revenue-equals-recognised')).toBe(true);
  });

  it('flags refunds above the payment, a missing receipt and a stale status', () => {
    const { m, s } = paidScenario();
    s.refunds.push({ paymentId: 'pay-1', invoiceId: 'inv-1', amount: 600, status: 'posted' });
    s.receipts = [];
    s.invoices[0]!.status = 'paid';
    const log = new ViolationLog(known);
    checkFeesSnapshot(log, m, s);
    expect(log.violations.has('refund-within-paid')).toBe(true);
    expect(log.violations.has('receipt-matches-payment')).toBe(true);
    expect(log.violations.has('status-consistent')).toBe(true);
  });

  it('checks the invoice against its adjustment lines and instalments', () => {
    const { m, s } = paidScenario();
    s.creditNotes = [{ invoiceId: 'inv-1', amount: 100, status: 'posted' }];
    s.structures = [{ id: 'st-1', amount: 1000, code: 'ST' }];
    s.instalments = [
      { structureId: 'st-1', amount: 500 },
      { structureId: 'st-1', amount: 499 },
    ];
    const log = new ViolationLog(known);
    checkFeesSnapshot(log, m, s);
    expect(log.violations.get('invoice-equals-lines')?.count).toBe(2);
  });

  it('flags netting above the disbursement and a payment reconciled twice', () => {
    const { m, s } = paidScenario();
    m.disbursements.push({ id: 'd-1', amount: 300, credits: new Map(), reversed: false });
    s.concessions = [
      {
        id: 'c1',
        invoiceId: 'inv-1',
        structureId: 'x',
        sourceDisbursementId: 'd-1',
        amount: 200,
        status: 'approved',
        journalId: null,
      },
      {
        id: 'c2',
        invoiceId: 'inv-2',
        structureId: 'x',
        sourceDisbursementId: 'd-1',
        amount: 200,
        status: 'approved',
        journalId: null,
      },
    ];
    s.reconRows = [
      {
        invoiceId: 'inv-1',
        paymentId: 'pay-1',
        amount: 600,
        matched: true,
        bankReference: 'U1',
        valueDate: '2026-11-01',
      },
      {
        invoiceId: 'inv-1',
        paymentId: 'pay-1',
        amount: 600,
        matched: true,
        bankReference: 'U2',
        valueDate: '2026-11-01',
      },
    ];
    const log = new ViolationLog(known);
    checkFeesSnapshot(log, m, s);
    expect(log.violations.has('netting-within-disbursement')).toBe(true);
    expect(log.violations.get('recon-matches-once')?.firstDetail).toMatch(/reconciled 2 times/);
  });

  it('discount and instalment oracles', () => {
    expect(expectedDiscount(1000, { kind: 'percent', percent: 33 })).toBe(330);
    expect(expectedDiscount(999, { kind: 'percent', percent: 50 })).toBe(499);
    expect(expectedDiscount(1000, { kind: 'amount', amountCents: 5000 })).toBe(1000);
    expect(expectedDiscount(1000, { kind: 'percent', percent: 120 })).toBeNull();
    expect(expectedInstalments(100, 3)).toEqual([34, 33, 33]);
    fc.assert(
      fc.property(fc.nat({ max: 1_000_000 }), fc.integer({ min: 1, max: 24 }), (a, n) => {
        const parts = expectedInstalments(a, n);
        return (
          parts.reduce((x, y) => x + y, 0) === a && Math.max(...parts) - Math.min(...parts) <= 1
        );
      }),
    );
  });
});
