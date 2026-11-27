/**
 * Fees: duplicate submits and several payers on one invoice.
 *
 * Contract (fees-plugin.ts, fees-service.ts PRC-M247/M511): a payment with a
 * body idempotencyKey replays the first settlement (200, same payment id);
 * the gateway Idempotency-Key header replays the cached response or answers
 * 409 while the first is in flight; a payment that would exceed the balance
 * or hits a paid invoice is refused (409, or 422 BUSINESS_RULE_ERROR, the
 * module's sequential refusal). Afterwards: Σ payments ≤ invoice total, one
 * receipt per payment, payment journals balanced and equal to Σ payments.
 */
import type { ApiClient, ApiResponse, Principal } from '../../../foundation/index.js';
import { allOf, checkStatuses, expectEq, type Check, type StatusContract } from '../race.js';

import {
  okBodies,
  S,
  statusesOf,
  uid,
  type RaceEnv,
  type Variant,
  type VariantRound,
} from './env.js';
const REFUSED = [409, 422] as const;
const TOTAL = 10_000;
async function createInvoice(env: RaceEnv, studentId: string, amountCents = TOTAL) {
  const r = await env.gateways[0]!.as(env.user('bursar')).post('/api/v1/fees/invoices', {
    studentId,
    title: `aitest t05 race ${uid()}`,
    amountCents,
  });
  const id = (r.json as { id?: string } | undefined)?.id;
  if (r.status !== 201 || !id)
    throw new Error(`invoice create -> ${r.status} ${r.text.slice(0, 200)}`);
  return id;
}
export async function feeBooks(env: RaceEnv, invoiceId: string) {
  const [p] = await env.q<{ n: string; total: string | null }>(
    `SELECT count(*)::text AS n, sum(amount_cents)::text AS total FROM parent_fee_payments
      WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'succeeded'`,
    [S, invoiceId],
  );
  const [rc] = await env.q<{ n: string }>(
    `SELECT count(*)::text AS n FROM parent_fee_receipts WHERE tenant_id = $1 AND invoice_id = $2`,
    [S, invoiceId],
  );
  const [l] = await env.q<{ debit: string | null; credit: string | null; cash: string | null }>(
    `SELECT sum(amount_cents) FILTER (WHERE side = 'debit')::text AS debit,
            sum(amount_cents) FILTER (WHERE side = 'credit')::text AS credit,
            sum(amount_cents) FILTER (WHERE side = 'debit' AND account = 'cash')::text AS cash
       FROM fee_ledger_entries WHERE tenant_id = $1 AND invoice_id = $2 AND payment_id IS NOT NULL`,
    [S, invoiceId],
  );
  const [inv] = await env.q<{ amount_cents: number; status: string }>(
    `SELECT amount_cents, status FROM parent_fee_invoices WHERE tenant_id = $1 AND id = $2`,
    [S, invoiceId],
  );
  return {
    payments: Number(p?.n ?? 0),
    paid: Number(p?.total ?? 0),
    receipts: Number(rc?.n ?? 0),
    debit: Number(l?.debit ?? 0),
    credit: Number(l?.credit ?? 0),
    cash: Number(l?.cash ?? 0),
    amount: Number(inv?.amount_cents ?? -1),
    status: inv?.status ?? 'missing',
  };
}
/** Books invariants common to every fees race. */
export function booksCheck(
  b: Awaited<ReturnType<typeof feeBooks>>,
  want: { payments: number; paid: number },
): Check {
  return allOf({
    payments: expectEq(b.payments, want.payments),
    paid: expectEq(b.paid, want.paid),
    'paid<=total': { ok: b.paid <= b.amount, detail: `${b.paid} of ${b.amount}` },
    'receipt per payment': expectEq(b.receipts, b.payments),
    'journal balanced': {
      ok: b.debit === b.credit && b.cash === b.paid,
      detail: `debit ${b.debit} credit ${b.credit} cash ${b.cash} paid ${b.paid}`,
    },
  });
}
const paymentIds = (runs: Parameters<typeof okBodies>[0]) =>
  new Set(okBodies<{ payment?: { id?: string } }>(runs).map((b) => b?.payment?.id ?? '?'));
/** Staff pay through /fees; a guardian pays through the parent-portal self-pay route. */
type Payer = { who: Principal; method: 'cash' | 'sandbox'; portal?: boolean };
async function payRace(
  env: RaceEnv,
  invoiceId: string,
  n: number,
  payer: (i: number) => Payer,
  body: (i: number) => Record<string, unknown>,
  headers?: (i: number) => Record<string, string>,
) {
  return env.fire(n, (api: ApiClient, i: number): Promise<ApiResponse> => {
    const p = payer(i);
    return api
      .as(p.who)
      .post(
        p.portal
          ? `/api/v1/parent-portal/fees/invoices/${invoiceId}/pay`
          : `/api/v1/fees/invoices/${invoiceId}/pay`,
        { method: p.method, ...body(i) },
        headers ? { headers: headers(i) } : {},
      );
  });
}
function variant(
  id: string,
  title: string,
  run: (env: RaceEnv, round: number) => Promise<VariantRound>,
): Variant {
  return { id: `fees-pay:${id}`, module: 'fees', title, run };
}
export const feesVariants: Variant[] = [
  variant(
    'same-body-key-x10',
    'one payer submits the same full payment 10x with the same body idempotencyKey',
    async (env, round) => {
      const [stu] = env.students(1);
      const invoiceId = await createInvoice(env, stu!);
      const key = `aitest-t05-${round}-${uid()}`;
      const runs = await payRace(
        env,
        invoiceId,
        10,
        () => ({ who: env.user('bursar'), method: 'cash' }),
        () => ({ amountCents: TOTAL, idempotencyKey: key }),
      );
      const statuses = statusesOf(runs);
      const ids = paymentIds(runs);
      const contract: StatusContract = { winners: { 201: 1, 200: [0, 9] }, losers: [409] };
      return {
        statuses,
        entities: { invoiceId, key },
        invariant: allOf({
          books: booksCheck(await feeBooks(env, invoiceId), { payments: 1, paid: TOTAL }),
          'one payment id in 2xx': { ok: ids.size === 1, detail: [...ids].join(',') },
        }),
        status: checkStatuses(statuses, contract),
      };
    },
  ),
  variant(
    'header-key-x10',
    'one payer submits the same full payment 10x with the same Idempotency-Key header',
    async (env, round) => {
      const [stu] = env.students(1);
      const invoiceId = await createInvoice(env, stu!);
      const key = `aitest-t05-${round}-${uid()}`;
      const runs = await payRace(
        env,
        invoiceId,
        10,
        () => ({ who: env.user('bursar'), method: 'cash' }),
        () => ({ amountCents: TOTAL }),
        () => ({ 'idempotency-key': key }),
      );
      const statuses = statusesOf(runs);
      const ids = paymentIds(runs);
      return {
        statuses,
        entities: { invoiceId, key },
        invariant: allOf({
          books: booksCheck(await feeBooks(env, invoiceId), { payments: 1, paid: TOTAL }),
          'one payment id in 2xx': { ok: ids.size === 1, detail: [...ids].join(',') },
        }),
        status: checkStatuses(statuses, { winners: { 201: [1, 10] }, losers: [409] }),
      };
    },
  ),
  variant(
    'full-no-key-x10',
    'one payer submits a full payment 10x without any idempotency key',
    async (env) => {
      const [stu] = env.students(1);
      const invoiceId = await createInvoice(env, stu!);
      const runs = await payRace(
        env,
        invoiceId,
        10,
        () => ({ who: env.user('bursar'), method: 'cash' }),
        () => ({ amountCents: TOTAL }),
      );
      const statuses = statusesOf(runs);
      return {
        statuses,
        entities: { invoiceId },
        invariant: booksCheck(await feeBooks(env, invoiceId), { payments: 1, paid: TOTAL }),
        status: checkStatuses(statuses, { winners: { 201: 1 }, losers: REFUSED }),
      };
    },
  ),
  variant('partial-x10', '10 parallel quarter payments: exactly 4 fit the balance', async (env) => {
    const [stu] = env.students(1);
    const invoiceId = await createInvoice(env, stu!);
    const runs = await payRace(
      env,
      invoiceId,
      10,
      () => ({ who: env.user('bursar'), method: 'cash' }),
      () => ({ amountCents: TOTAL / 4 }),
    );
    const statuses = statusesOf(runs);
    const b = await feeBooks(env, invoiceId);
    return {
      statuses,
      entities: { invoiceId },
      invariant: allOf({
        books: booksCheck(b, { payments: 4, paid: TOTAL }),
        'invoice paid': expectEq(b.status, 'paid'),
      }),
      status: checkStatuses(statuses, { winners: { 201: 4 }, losers: REFUSED }),
    };
  }),
  variant(
    'two-staff-users-x4',
    'bursar and accountant pay the same invoice in full at the same time (2 requests each)',
    async (env) => {
      const [stu] = env.students(1);
      const invoiceId = await createInvoice(env, stu!);
      const users = [env.user('bursar'), env.user('accountant')];
      const runs = await payRace(
        env,
        invoiceId,
        4,
        (i) => ({ who: users[i % 2]!, method: 'cash' }),
        () => ({ amountCents: TOTAL }),
      );
      const statuses = statusesOf(runs);
      return {
        statuses,
        entities: { invoiceId },
        invariant: booksCheck(await feeBooks(env, invoiceId), { payments: 1, paid: TOTAL }),
        status: checkStatuses(statuses, { winners: { 201: 1 }, losers: REFUSED }),
      };
    },
  ),
  variant(
    'staff-and-guardian-x4',
    "bursar (cash) and the student's linked guardian (online) pay the same invoice at the same time",
    async (env) => {
      const invoiceId = await createInvoice(env, env.guardianStudentId);
      const runs = await payRace(
        env,
        invoiceId,
        4,
        (i) =>
          i % 2 === 0
            ? { who: env.user('bursar'), method: 'cash' }
            : { who: env.guardian, method: 'sandbox', portal: true },
        () => ({}),
      );
      const statuses = statusesOf(runs);
      return {
        statuses,
        entities: { invoiceId, guardian: env.guardian.sub },
        invariant: booksCheck(await feeBooks(env, invoiceId), { payments: 1, paid: TOTAL }),
        // Staff settle with 201. The portal answers 200 and keys the guardian's payment per
        // (invoice, payer) (PRC-C001), so the guardian's second request replays with 200.
        status: checkStatuses(statuses, {
          winners: { 201: [0, 1], 200: [0, 2] },
          totalWinners: [1, 2],
          losers: REFUSED,
        }),
      };
    },
  ),
  variant(
    'guardian-two-sessions-x4',
    'the linked guardian pays the same invoice from two sessions (two devices, both gateways)',
    async (env, round) => {
      const invoiceId = await createInvoice(env, env.guardianStudentId);
      const sessions = [0, 1].map((k) => ({
        ...env.guardian,
        jti: `aitest-t05-${round}-${k}-${uid()}`,
      }));
      const runs = await payRace(
        env,
        invoiceId,
        4,
        (i) => ({ who: sessions[i % 2]!, method: 'sandbox', portal: true }),
        () => ({}),
      );
      const statuses = statusesOf(runs);
      const ids = paymentIds(runs);
      return {
        statuses,
        entities: { invoiceId, guardian: env.guardian.sub },
        invariant: allOf({
          books: booksCheck(await feeBooks(env, invoiceId), { payments: 1, paid: TOTAL }),
          'one payment id in 2xx': { ok: ids.size === 1, detail: [...ids].join(',') },
        }),
        // Portal payments are keyed per (invoice, payer): first settles, the rest replay (200).
        status: checkStatuses(statuses, { winners: { 200: [1, 4] }, losers: [409] }),
      };
    },
  ),
];
