/**
 * PRC-M481: only FAILED disbursements of this tenant are re-queued; client ids are
 * validated and re-checked server-side.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/scholarships', () => ({
  approveScholarshipApplication: vi.fn(),
  createScholarshipProgram: vi.fn(),
  listScholarshipDisbursements: vi.fn(),
  rejectScholarshipApplication: vi.fn(),
  updateDisbursement: vi.fn(),
  updateScholarshipProgram: vi.fn(),
}));

import { listScholarshipDisbursements, updateDisbursement } from '@/lib/api/scholarships';
import { retryFailedDisbursementsAction } from './actions';

const FAILED = '11111111-1111-4111-8111-111111111111';
const PAID = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';

function row(id: string, status: 'SCHEDULED' | 'PROCESSED' | 'FAILED') {
  return {
    id,
    applicationId: 'a',
    applicantName: 'x',
    programName: 'p',
    amount: 1,
    currency: 'INR',
    paymentDate: '2025-01-01',
    paymentMethod: 'BANK_TRANSFER' as const,
    status,
  };
}

beforeEach(() => {
  vi.mocked(updateDisbursement)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(listScholarshipDisbursements)
    .mockReset()
    .mockResolvedValue({ ok: true, items: [row(FAILED, 'FAILED'), row(PAID, 'PROCESSED')] });
});

describe('retryFailedDisbursementsAction (PRC-M481)', () => {
  it('a PAID disbursement id returns an error and is never PUT', async () => {
    const result = await retryFailedDisbursementsAction([PAID]);
    expect(result.status).toBe('error');
    expect(updateDisbursement).not.toHaveBeenCalled();
  });

  it("another tenant's id is skipped as not found", async () => {
    const result = await retryFailedDisbursementsAction([OTHER_TENANT]);
    expect(result.status).toBe('error');
    expect(result.results?.[0]).toMatchObject({ outcome: 'skipped', reason: 'not found' });
    expect(updateDisbursement).not.toHaveBeenCalled();
  });

  it('re-queues only the failed id and reports per-id results', async () => {
    const result = await retryFailedDisbursementsAction([FAILED, PAID, FAILED]);
    expect(result.status).toBe('success');
    expect(updateDisbursement).toHaveBeenCalledTimes(1);
    expect(updateDisbursement).toHaveBeenCalledWith(
      FAILED,
      expect.objectContaining({ paymentStatus: 'scheduled' }),
    );
    expect(result.message).toContain('1 skipped');
  });

  it('a failed disbursement list load is an error, not "not found" for every id', async () => {
    vi.mocked(listScholarshipDisbursements).mockResolvedValue({
      ok: false,
      kind: 'unavailable',
      status: 503,
    });
    const result = await retryFailedDisbursementsAction([FAILED]);
    expect(result).toMatchObject({ status: 'error', message: 'Could not load disbursements.' });
    expect(updateDisbursement).not.toHaveBeenCalled();
  });
  it('rejects non-uuid ids and oversized batches', async () => {
    expect((await retryFailedDisbursementsAction(['../evil'])).status).toBe('error');
    const many = Array.from({ length: 101 }, () => FAILED);
    expect((await retryFailedDisbursementsAction(many)).status).toBe('error');
    expect(listScholarshipDisbursements).not.toHaveBeenCalled();
  });
});
