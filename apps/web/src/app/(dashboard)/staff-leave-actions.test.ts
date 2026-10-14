/**
 * @vitest-environment node
 *
 * PRC-L412 — staff leave server-action unit tests. Covers the success path,
 * the approve/reject decision mapping, and GatewayError message mapping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayError } from '@/lib/api/gateway';

const createStaffLeave = vi.fn();
const decideStaffLeave = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/staff', () => ({
  createStaffLeave: (...a: unknown[]) => createStaffLeave(...a),
  decideStaffLeave: (...a: unknown[]) => decideStaffLeave(...a),
}));

import { createStaffLeaveAction, decideStaffLeaveAction } from './staff-leave-actions';

describe('staff leave actions (PRC-L412)', () => {
  beforeEach(() => {
    createStaffLeave.mockReset();
    decideStaffLeave.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('records a leave request and returns its id', async () => {
    createStaffLeave.mockResolvedValue({ id: 'leave-1' });
    const res = await createStaffLeaveAction({
      staffId: 's1',
      leaveType: 'casual',
      startDate: '2026-10-20',
      endDate: '2026-10-21',
      reason: 'Family',
    } as never);
    expect(res.status).toBe('success');
    expect(res.id).toBe('leave-1');
  });

  it('maps a GatewayError message when create fails', async () => {
    createStaffLeave.mockRejectedValue(
      new GatewayError({ status: 409, code: 'OVERLAP', message: 'Overlapping leave' }),
    );
    const res = await createStaffLeaveAction({} as never);
    expect(res.status).toBe('error');
    expect(res.message).toBe('Overlapping leave');
  });

  it('reports an approval decision', async () => {
    decideStaffLeave.mockResolvedValue({ id: 'leave-1' });
    const res = await decideStaffLeaveAction('leave-1', 'approved');
    expect(decideStaffLeave).toHaveBeenCalledWith('leave-1', 'approved');
    expect(res.status).toBe('success');
    expect(res.message).toMatch(/approved/i);
  });

  it('reports a rejection decision', async () => {
    decideStaffLeave.mockResolvedValue({ id: 'leave-1' });
    const res = await decideStaffLeaveAction('leave-1', 'rejected');
    expect(res.message).toMatch(/rejected/i);
  });

  it('maps a GatewayError message when a decision fails', async () => {
    decideStaffLeave.mockRejectedValue(
      new GatewayError({ status: 403, code: 'FORBIDDEN', message: 'Not your report' }),
    );
    const res = await decideStaffLeaveAction('leave-1', 'approved');
    expect(res.status).toBe('error');
    expect(res.message).toBe('Not your report');
  });
});
