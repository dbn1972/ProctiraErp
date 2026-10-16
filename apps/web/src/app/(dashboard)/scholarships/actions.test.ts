/**
 * @vitest-environment node
 *
 * PRC-L412 — scholarship server-action unit tests.
 *
 * Covers the money-moving paths that previously only ran under slow e2e:
 *   • retryFailedDisbursementsAction NEVER forwards a non-FAILED id to the
 *     gateway (acceptance: "Tests fail if the retry action forwards a
 *     non-failed id");
 *   • a cross-tenant / unknown id is skipped, never PUT;
 *   • decideApplicationAction validates the id and maps GatewayError messages.
 *
 * The scholarships API client and next/cache are mocked so the action logic is
 * exercised in isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayError } from '@/lib/api/gateway';

const listScholarshipDisbursements = vi.fn();
const updateDisbursement = vi.fn();
const approveScholarshipApplication = vi.fn();
const rejectScholarshipApplication = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/scholarships/disbursement-paid', () => ({
  buildPaidUpdateBody: (input: { transactionReference: string; paidDate: string }) =>
    input.transactionReference && input.paidDate
      ? { ok: true, body: { paymentStatus: 'paid', ...input } }
      : { ok: false, error: 'Transaction reference and paid date are required.' },
}));
vi.mock('@/lib/api/scholarships', () => ({
  listScholarshipDisbursements: (...a: unknown[]) => listScholarshipDisbursements(...a),
  updateDisbursement: (...a: unknown[]) => updateDisbursement(...a),
  approveScholarshipApplication: (...a: unknown[]) => approveScholarshipApplication(...a),
  rejectScholarshipApplication: (...a: unknown[]) => rejectScholarshipApplication(...a),
  createScholarshipProgram: vi.fn(),
  updateScholarshipProgram: vi.fn(),
}));

import { decideApplicationAction, retryFailedDisbursementsAction } from './actions';

const FAILED_ID = '11111111-1111-4111-8111-111111111111';
const PAID_ID = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_ID = '33333333-3333-4333-8333-333333333333';

function disbursement(id: string, status: string) {
  return { id, status, programId: 'prog-1' };
}

describe('retryFailedDisbursementsAction (PRC-L412 / PRC-M481)', () => {
  beforeEach(() => {
    listScholarshipDisbursements.mockReset();
    updateDisbursement.mockReset();
    updateDisbursement.mockResolvedValue({ id: FAILED_ID });
  });
  afterEach(() => vi.clearAllMocks());

  it('queues a FAILED id by PUTting paymentStatus:scheduled', async () => {
    listScholarshipDisbursements.mockResolvedValue({
      ok: true,
      items: [disbursement(FAILED_ID, 'FAILED')],
    });
    const res = await retryFailedDisbursementsAction([FAILED_ID]);
    expect(res.status).toBe('success');
    expect(updateDisbursement).toHaveBeenCalledTimes(1);
    expect(updateDisbursement).toHaveBeenCalledWith(
      FAILED_ID,
      expect.objectContaining({ paymentStatus: 'scheduled' }),
    );
  });

  it('NEVER forwards a non-FAILED id to the gateway (acceptance)', async () => {
    listScholarshipDisbursements.mockResolvedValue({
      ok: true,
      items: [disbursement(PAID_ID, 'PAID')],
    });
    const res = await retryFailedDisbursementsAction([PAID_ID]);
    expect(updateDisbursement).not.toHaveBeenCalled();
    expect(res.status).toBe('error');
    expect(res.results?.[0]).toMatchObject({ id: PAID_ID, outcome: 'skipped' });
  });

  it('skips an unknown / cross-tenant id without a PUT', async () => {
    listScholarshipDisbursements.mockResolvedValue({
      ok: true,
      items: [disbursement(FAILED_ID, 'FAILED')],
    });
    const res = await retryFailedDisbursementsAction([UNKNOWN_ID]);
    expect(updateDisbursement).not.toHaveBeenCalled();
    expect(res.results?.find((r) => r.id === UNKNOWN_ID)).toMatchObject({
      outcome: 'skipped',
      reason: 'not found',
    });
  });

  it('treats a failed list load as an error, not "all not found"', async () => {
    listScholarshipDisbursements.mockResolvedValue({ ok: false });
    const res = await retryFailedDisbursementsAction([FAILED_ID]);
    expect(res.status).toBe('error');
    expect(updateDisbursement).not.toHaveBeenCalled();
  });

  it('rejects an empty / oversized id list before touching the gateway', async () => {
    expect((await retryFailedDisbursementsAction([])).status).toBe('error');
    expect((await retryFailedDisbursementsAction(['not-a-uuid'])).status).toBe('error');
    expect(listScholarshipDisbursements).not.toHaveBeenCalled();
  });
});

describe('decideApplicationAction (PRC-L412)', () => {
  beforeEach(() => {
    approveScholarshipApplication.mockReset();
    rejectScholarshipApplication.mockReset();
  });

  it('rejects an invalid application id before any gateway call', async () => {
    const res = await decideApplicationAction({ applicationId: 'nope', decision: 'approve' });
    expect(res.status).toBe('error');
    expect(approveScholarshipApplication).not.toHaveBeenCalled();
  });

  it('approves and reports the scheduled-instalment message', async () => {
    approveScholarshipApplication.mockResolvedValue({ programId: 'prog-1' });
    const res = await decideApplicationAction({ applicationId: FAILED_ID, decision: 'approve' });
    expect(res.status).toBe('success');
    expect(res.message).toMatch(/instalment scheduled/i);
  });

  it('maps a GatewayError message on reject', async () => {
    rejectScholarshipApplication.mockRejectedValue(
      new GatewayError({ status: 409, code: 'CONFLICT', message: 'Already decided' }),
    );
    const res = await decideApplicationAction({ applicationId: FAILED_ID, decision: 'reject' });
    expect(res.status).toBe('error');
    expect(res.message).toBe('Already decided');
  });

  it('rejects an over-long comment', async () => {
    const res = await decideApplicationAction({
      applicationId: FAILED_ID,
      decision: 'approve',
      comment: 'x'.repeat(2001),
    });
    expect(res.status).toBe('error');
    expect(approveScholarshipApplication).not.toHaveBeenCalled();
  });
});
