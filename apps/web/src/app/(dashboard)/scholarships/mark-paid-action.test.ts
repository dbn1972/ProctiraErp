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

import { updateDisbursement } from '@/lib/api/scholarships';

import { markDisbursementPaidAction } from './actions';

const ID = '11111111-1111-4111-8111-111111111111';

describe('markDisbursementPaidAction (PRC-H085)', () => {
  beforeEach(() => {
    vi.mocked(updateDisbursement).mockReset();
  });

  it('sends paymentStatus, transactionReference and paidDate', async () => {
    vi.mocked(updateDisbursement).mockResolvedValue({} as never);
    const result = await markDisbursementPaidAction(ID, {
      transactionReference: '  UTR-123  ',
      paidDate: '2025-01-15',
    });
    expect(result.status).toBe('success');
    expect(updateDisbursement).toHaveBeenCalledWith(ID, {
      paymentStatus: 'paid',
      transactionReference: 'UTR-123',
      paidDate: '2025-01-15',
    });
  });

  it('rejects a blank reference without calling the gateway', async () => {
    const result = await markDisbursementPaidAction(ID, {
      transactionReference: '   ',
      paidDate: '2025-01-15',
    });
    expect(result).toMatchObject({ status: 'error' });
    expect(updateDisbursement).not.toHaveBeenCalled();
  });

  it('rejects a malformed paid date', async () => {
    const result = await markDisbursementPaidAction(ID, {
      transactionReference: 'UTR-1',
      paidDate: '15/01/2025',
    });
    expect(result.status).toBe('error');
    expect(updateDisbursement).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id', async () => {
    const result = await markDisbursementPaidAction('x', {
      transactionReference: 'UTR-1',
      paidDate: '2025-01-15',
    });
    expect(result.status).toBe('error');
  });
});
