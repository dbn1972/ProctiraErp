/**
 * Fees model (pure): expected balances in integer paise and the invariant
 * checker that compares a database snapshot with the model.
 *
 * Expected-result sources: fees-service.ts doc comments (G-718 journals,
 * W2-FIN-01 partial payments, PRC-H058/H059 void, PRC-M245 concession and
 * credit-note caps, PRC-M246 refund per payment, F-D1/F-D2 scholarship
 * netting, W2-FIN-08 netting reversal, PRC-M251 reconciliation), money-cents.ts
 * (integer cents) and the BRIEF invariants.
 */
import { COMMON_INVARIANTS, type InvariantMeta, type ViolationLog } from './core.js';

export type InvoiceStatus = 'open' | 'paid' | 'void' | 'written_off' | 'overdue';

export interface MPayment {
  id: string;
  amount: number;
  refunded: number;
}

export interface MInvoice {
  id: string;
  number: string;
  kind: 'adhoc' | 'plan' | 'structure';
  structureId: string | null;
  issued: number;
  face: number;
  status: InvoiceStatus;
  payments: MPayment[];
}

export interface MConcession {
  id: string;
  structureId: string;
  invoiceId: string;
  discount: number;
  status: 'pending' | 'approved' | 'rejected';
  createdBy: string;
}

export interface MDisbursement {
  id: string;
  amount: number;
  /** invoice id -> paise credited (live rows only). */
  credits: Map<string, number>;
  reversed: boolean;
}

export interface MStructure {
  id: string;
  amount: number;
  partCount: number;
}

export interface FeesModel {
  plans: Array<{ id: string; amount: number }>;
  structures: MStructure[];
  invoices: MInvoice[];
  concessions: MConcession[];
  disbursements: MDisbursement[];
  reconciledPayments: Set<string>;
  reconciledLineKeys: Set<string>;
  matchedLines: Array<{ number: string; amount: number; ref: string; date: string }>;
  keyedPayments: Array<{ key: string; invoiceId: string; paymentId: string; amount: number }>;
  lastCsv: string | null;
  /** normalised file content -> matched count of its first import */
  priorFiles: Map<string, number>;
  seq: number;
}

export function emptyFeesModel(): FeesModel {
  return {
    plans: [],
    structures: [],
    invoices: [],
    concessions: [],
    disbursements: [],
    reconciledPayments: new Set(),
    reconciledLineKeys: new Set(),
    matchedLines: [],
    keyedPayments: [],
    lastCsv: null,
    priorFiles: new Map(),
    seq: 0,
  };
}

export const paidOf = (i: MInvoice) => i.payments.reduce((s, p) => s + p.amount, 0);
export const refundedOf = (i: MInvoice) => i.payments.reduce((s, p) => s + p.refunded, 0);
export const unpaidOf = (i: MInvoice) => Math.max(0, i.face - paidOf(i));

/** concessionDiscountCents rule, re-implemented (floor percent, capped at structure amount). */
export function expectedDiscount(
  structureAmount: number,
  c: { kind: 'percent' | 'amount'; percent?: number; amountCents?: number },
): number | null {
  if (c.kind === 'percent') {
    const p = c.percent ?? 0;
    if (!Number.isFinite(p) || p < 0 || p > 100) return null;
    return Math.min(structureAmount, Math.floor((structureAmount * p) / 100));
  }
  const a = c.amountCents ?? 0;
  if (!Number.isInteger(a) || a < 0) return null;
  return Math.min(structureAmount, a);
}

/** Even split with the remainder on the first parts (instalment rule). */
export function expectedInstalments(amount: number, parts: number): number[] {
  const base = Math.floor(amount / parts);
  const rem = amount % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

// ─── Snapshot read from Postgres (tenant scope, runtime role) ────────────────

export interface LedgerRow {
  journalId: string;
  invoiceId: string | null;
  account: 'accounts_receivable' | 'cash' | 'fee_revenue' | 'bad_debt_expense';
  side: 'debit' | 'credit';
  amount: number;
}

export interface FeesSnapshot {
  ledger: LedgerRow[];
  invoices: Array<{ id: string; face: number; status: string; structureId: string | null }>;
  payments: Array<{ id: string; invoiceId: string; amount: number; status: string }>;
  receipts: Array<{ paymentId: string; invoiceId: string; amount: number }>;
  refunds: Array<{ paymentId: string | null; invoiceId: string; amount: number; status: string }>;
  creditNotes: Array<{ invoiceId: string; amount: number; status: string }>;
  writeOffs: Array<{ invoiceId: string; amount: number; status: string }>;
  concessions: Array<{
    id: string;
    invoiceId: string | null;
    structureId: string;
    sourceDisbursementId: string | null;
    amount: number | null;
    status: string;
    journalId: string | null;
  }>;
  instalments: Array<{ structureId: string; amount: number }>;
  structures: Array<{ id: string; amount: number; code: string }>;
  reconRows: Array<{
    invoiceId: string | null;
    paymentId: string | null;
    amount: number;
    matched: boolean;
    bankReference: string | null;
    valueDate: string | null;
  }>;
}

export const FEES_INVARIANTS: InvariantMeta[] = [
  {
    id: 'ledger-balanced',
    title: 'Every fee journal balances and the tenant trial balance nets to zero',
    module: 'fees',
    category: 'money',
    severity: 'critical',
    source: 'G-718 double-entry ledger (fees-service.ts postJournal, db/sql/023)',
  },
  {
    id: 'ar-equals-outstanding',
    title: 'Accounts receivable per invoice equals face minus collected (zero once void)',
    module: 'fees',
    category: 'money',
    severity: 'high',
    source: 'G-718 journals; PRC-H059 void reverses only the unpaid remainder',
  },
  {
    id: 'cash-equals-net-collected',
    title: 'Cash per invoice equals payments minus refunds',
    module: 'fees',
    category: 'money',
    severity: 'high',
    source: 'payment DR cash / refund CR cash journals',
  },
  {
    id: 'revenue-equals-recognised',
    title: 'Fee revenue per invoice equals billed minus credits, refunds and void reversal',
    module: 'fees',
    category: 'money',
    severity: 'high',
    source: 'G-718 / W2-FIN-05 journals',
  },
  {
    id: 'invoice-equals-lines',
    title:
      'Invoice amount equals issued amount minus its adjustment lines; structure equals the sum of its instalments',
    module: 'fees',
    category: 'money',
    severity: 'high',
    source: 'BRIEF; PRC-M245 / W2-FIN-05 adjust the face; allocateInstalments',
  },
  {
    id: 'paid-within-face',
    title: 'Collected cash never exceeds the invoice amount',
    module: 'fees',
    category: 'money',
    severity: 'high',
    source: 'W2-FIN-01 payment within remaining balance; PRC-M245 concession never below cash',
  },
  {
    id: 'refund-within-paid',
    title: 'Refunds never exceed the amount paid (per payment and per invoice)',
    module: 'fees',
    category: 'money',
    severity: 'critical',
    source: 'BRIEF; PRC-H058 / PRC-M246 refund caps',
  },
  {
    id: 'receipt-matches-payment',
    title: 'Each payment has exactly one receipt of the same amount',
    module: 'fees',
    category: 'money',
    severity: 'high',
    source: 'W3-TEST-01 receipt.amountCents === payment.amountCents',
  },
  {
    id: 'status-consistent',
    title: 'Invoice status agrees with its balance (open owes, paid/written-off owe nothing)',
    module: 'fees',
    category: 'money',
    severity: 'medium',
    source: 'PRC-M245 settle on zero unpaid; W2-FIN-05 written_off at zero',
  },
  {
    id: 'netting-within-disbursement',
    title: 'Scholarship netting never credits more than the disbursement, once per invoice',
    module: 'fees',
    category: 'money',
    severity: 'critical',
    source: 'F-D2 netting (db/sql/305 unique per disbursement and invoice)',
  },
  {
    id: 'recon-matches-once',
    title: 'A bank line reconciles one payment of the same amount on the named invoice, once',
    module: 'fees',
    category: 'money',
    severity: 'high',
    source: 'PRC-M251 reconciliation matching (db/sql/331)',
  },
  {
    id: 'reports-match-ledger',
    title: 'Dues report and refundable-payment list agree with payments and refunds',
    module: 'fees',
    category: 'money',
    severity: 'medium',
    source: 'PRC-M249 outstanding = face - succeeded payments; PRC-M090 refundable',
  },
  ...COMMON_INVARIANTS('fees'),
];

function sumBy<T>(rows: readonly T[], f: (r: T) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

/** Per-invoice account balance (debit − credit). */
export function accountBalances(ledger: readonly LedgerRow[]) {
  const out = new Map<string, Record<LedgerRow['account'], number>>();
  for (const r of ledger) {
    const key = r.invoiceId ?? '';
    const acc = out.get(key) ?? {
      accounts_receivable: 0,
      cash: 0,
      fee_revenue: 0,
      bad_debt_expense: 0,
    };
    acc[r.account] += r.side === 'debit' ? r.amount : -r.amount;
    out.set(key, acc);
  }
  return out;
}

/** Journals whose debits differ from credits. */
export function unbalancedJournals(
  ledger: readonly LedgerRow[],
): Array<{ journalId: string; debit: number; credit: number }> {
  const j = new Map<string, { debit: number; credit: number }>();
  for (const r of ledger) {
    const row = j.get(r.journalId) ?? { debit: 0, credit: 0 };
    row[r.side] += r.amount;
    j.set(r.journalId, row);
  }
  return [...j.entries()]
    .filter(([, v]) => v.debit !== v.credit)
    .map(([journalId, v]) => ({ journalId, ...v }));
}

/**
 * Check every snapshot invariant against the model. Pure; unit-tested on
 * hand-made balanced and unbalanced ledgers.
 */
export function checkFeesSnapshot(log: ViolationLog, m: FeesModel, s: FeesSnapshot): void {
  // ledger-balanced
  const bad = unbalancedJournals(s.ledger);
  log.check(
    'ledger-balanced',
    bad.length === 0,
    () => `unbalanced journals ${JSON.stringify(bad.slice(0, 3))}`,
  );
  const totDebit = sumBy(
    s.ledger.filter((r) => r.side === 'debit'),
    (r) => r.amount,
  );
  const totCredit = sumBy(
    s.ledger.filter((r) => r.side === 'credit'),
    (r) => r.amount,
  );
  log.check(
    'ledger-balanced',
    totDebit === totCredit,
    () => `trial balance debit ${totDebit} != credit ${totCredit}`,
  );

  const balances = accountBalances(s.ledger);
  const byInvoice = new Map(s.invoices.map((i) => [i.id, i]));
  const paymentsByInvoice = new Map<string, typeof s.payments>();
  for (const p of s.payments) {
    const list = paymentsByInvoice.get(p.invoiceId) ?? [];
    list.push(p);
    paymentsByInvoice.set(p.invoiceId, list);
  }
  const zero = { accounts_receivable: 0, cash: 0, fee_revenue: 0, bad_debt_expense: 0 };

  for (const inv of m.invoices) {
    const db = byInvoice.get(inv.id);
    if (!db) {
      log.check('invoice-equals-lines', false, () => `invoice ${inv.number} missing in database`);
      continue;
    }
    const pays = (paymentsByInvoice.get(inv.id) ?? []).filter((p) => p.status === 'succeeded');
    const paid = sumBy(pays, (p) => p.amount);
    const refunds = s.refunds.filter((r) => r.invoiceId === inv.id && r.status === 'posted');
    const refunded = sumBy(refunds, (r) => r.amount);
    const cn = sumBy(
      s.creditNotes.filter((r) => r.invoiceId === inv.id && r.status === 'posted'),
      (r) => r.amount,
    );
    const wo = sumBy(
      s.writeOffs.filter((r) => r.invoiceId === inv.id && r.status === 'posted'),
      (r) => r.amount,
    );
    const conc = s.concessions.filter((c) => c.invoiceId === inv.id && c.status === 'approved');
    const netting = sumBy(
      conc.filter((c) => c.sourceDisbursementId != null),
      (c) => c.amount ?? 0,
    );
    const manualJournals = new Set(
      conc.filter((c) => c.sourceDisbursementId == null && c.journalId).map((c) => c.journalId!),
    );
    const manual = sumBy(
      s.ledger.filter(
        (r) => manualJournals.has(r.journalId) && r.account === 'fee_revenue' && r.side === 'debit',
      ),
      (r) => r.amount,
    );
    const bal = balances.get(inv.id) ?? zero;
    const isVoid = db.status === 'void';
    const tag = `${inv.number} (${inv.kind}, status ${db.status}, face ${db.face}, paid ${paid}, refunded ${refunded})`;

    log.check(
      'ar-equals-outstanding',
      bal.accounts_receivable === (isVoid ? 0 : db.face - paid),
      () =>
        `${tag}: AR ${bal.accounts_receivable}, expected ${isVoid ? 0 : db.face - paid} (${isVoid ? 'void invoice owes nothing' : 'face - paid'})`,
    );
    log.check(
      'cash-equals-net-collected',
      bal.cash === paid - refunded,
      () => `${tag}: cash ${bal.cash}, expected paid - refunded = ${paid - refunded}`,
    );
    const revenue = -bal.fee_revenue;
    const expectedRevenue = (isVoid ? paid : db.face) + wo - refunded;
    log.check(
      'revenue-equals-recognised',
      revenue === expectedRevenue && bal.bad_debt_expense === wo,
      () =>
        `${tag}: revenue ${revenue} (expected ${expectedRevenue}), bad debt ${bal.bad_debt_expense} (expected ${wo})`,
    );
    const lines = inv.issued - cn - wo - manual - netting;
    log.check(
      'invoice-equals-lines',
      db.face === lines && db.face === inv.face,
      () =>
        `${tag}: face ${db.face}; issued ${inv.issued} - credit notes ${cn} - write-offs ${wo} - concessions ${manual} - netting ${netting} = ${lines}; model ${inv.face}`,
    );
    log.check(
      'paid-within-face',
      paid <= db.face,
      () => `${tag}: collected ${paid} exceeds invoice amount ${db.face}`,
    );
    log.check(
      'refund-within-paid',
      refunded <= paid,
      () => `${tag}: refunded ${refunded} exceeds paid ${paid}`,
    );
    for (const p of pays) {
      const onP = sumBy(
        refunds.filter((r) => r.paymentId === p.id),
        (r) => r.amount,
      );
      log.check(
        'refund-within-paid',
        onP <= p.amount,
        () => `${tag}: payment ${p.id.slice(0, 8)} amount ${p.amount} refunded ${onP}`,
      );
      const rc = s.receipts.filter((r) => r.paymentId === p.id);
      log.check(
        'receipt-matches-payment',
        rc.length === 1 && rc[0]!.amount === p.amount && rc[0]!.invoiceId === inv.id,
        () => `${tag}: payment ${p.amount} has receipts ${JSON.stringify(rc.map((r) => r.amount))}`,
      );
    }
    const owes = db.face - paid;
    const consistent =
      db.status === 'void' ||
      (db.status === 'open' && owes > 0) ||
      ((db.status === 'paid' || db.status === 'written_off') && owes === 0);
    log.check('status-consistent', consistent, () => `${tag}: status vs owed ${owes}`);
  }

  // structures: instalments sum to the structure amount
  for (const st of s.structures) {
    const parts = s.instalments.filter((x) => x.structureId === st.id);
    if (parts.length === 0) continue;
    const total = sumBy(parts, (x) => x.amount);
    log.check(
      'invoice-equals-lines',
      total === st.amount,
      () => `structure ${st.code}: instalments sum ${total} != structure amount ${st.amount}`,
    );
  }

  // netting-within-disbursement
  for (const d of m.disbursements) {
    const rows = s.concessions.filter((c) => c.sourceDisbursementId === d.id);
    const live = rows.filter((c) => c.status !== 'rejected');
    const netted = sumBy(live, (c) => c.amount ?? 0);
    const perInvoice = new Map<string, number>();
    for (const c of live)
      perInvoice.set(c.invoiceId ?? '', (perInvoice.get(c.invoiceId ?? '') ?? 0) + 1);
    log.check(
      'netting-within-disbursement',
      netted <= d.amount && [...perInvoice.values()].every((n) => n <= 1),
      () =>
        `disbursement ${d.id.slice(0, 8)} amount ${d.amount}: netted ${netted} over ${live.length} rows`,
    );
    if (d.reversed) {
      log.check(
        'netting-within-disbursement',
        live.length === 0,
        () =>
          `reversed disbursement ${d.id.slice(0, 8)} still has ${live.length} live netting rows`,
      );
    }
  }

  // recon-matches-once
  const matched = s.reconRows.filter((r) => r.matched);
  const seenPayment = new Map<string, number>();
  const seenKey = new Map<string, number>();
  for (const r of matched) {
    if (r.paymentId) seenPayment.set(r.paymentId, (seenPayment.get(r.paymentId) ?? 0) + 1);
    if (r.bankReference && r.valueDate) {
      const k = `${r.bankReference}|${r.amount}|${r.valueDate}`;
      seenKey.set(k, (seenKey.get(k) ?? 0) + 1);
    }
    const p = s.payments.find((x) => x.id === r.paymentId);
    log.check(
      'recon-matches-once',
      p !== undefined && p.amount === r.amount && p.invoiceId === r.invoiceId,
      () =>
        `matched bank line ${r.amount} on invoice ${String(r.invoiceId?.slice(0, 8))} -> payment ${
          p ? `${p.amount} on ${p.invoiceId.slice(0, 8)}` : 'none'
        }`,
    );
  }
  for (const [pid, n] of seenPayment) {
    log.check(
      'recon-matches-once',
      n <= 1,
      () => `payment ${pid.slice(0, 8)} reconciled ${n} times`,
    );
  }
  for (const [k, n] of seenKey) {
    log.check('recon-matches-once', n <= 1, () => `bank line ${k} reconciled ${n} times`);
  }
}
