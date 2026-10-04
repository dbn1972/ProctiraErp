/**
 * PRC-L033 — campus / communication server actions reject malformed ids and
 * dates before any gateway call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const hostel = vi.hoisted(() => ({
  createHostel: vi.fn(),
  createHostelAssignment: vi.fn(),
  createHostelBed: vi.fn(),
  createHostelBlock: vi.fn(),
  createHostelLeave: vi.fn(),
  createHostelRoom: vi.fn(),
  createHostelVisitor: vi.fn(),
  decideHostelLeave: vi.fn(),
  updateHostelVisitorStatus: vi.fn(),
}));
const library = vi.hoisted(() => ({
  checkoutLibraryItem: vi.fn(),
  createLibraryItem: vi.fn(),
  getLibraryClearance: vi.fn(),
  renewLibraryLoan: vi.fn(),
  returnLibraryLoan: vi.fn(),
}));
const communication = vi.hoisted(() => ({
  ackCircular: vi.fn(),
  confirmEmergencyBlast: vi.fn(),
  createCampaign: vi.fn(),
  createCircular: vi.fn(),
  createEmergencyBlast: vi.fn(),
  dispatchEmergencyBlast: vi.fn(),
  previewCampaignAudience: vi.fn(),
  retryDeliveryLog: vi.fn(),
  sendCampaign: vi.fn(),
  sendCircular: vi.fn(),
}));
vi.mock('@/lib/api/hostel', () => hostel);
vi.mock('@/lib/api/library', () => library);
vi.mock('@/lib/api/communication', () => communication);

import {
  createHostelLeaveAction,
  decideHostelLeaveAction,
  returnLibraryLoanAction,
  checkLibraryClearanceAction,
} from './campus-actions';
import {
  confirmEmergencyBlastAction,
  dispatchEmergencyBlastAction,
  sendCircularAction,
} from './communication/actions';
import { gatePassWindowSchema } from '@/lib/validation/campus-action-schema';

const ID = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';

describe('campus/communication action validation (PRC-L033)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects id='../x' without calling the gateway", async () => {
    const results = await Promise.all([
      confirmEmergencyBlastAction('../x'),
      dispatchEmergencyBlastAction('../x'),
      sendCircularAction('../x'),
      decideHostelLeaveAction('../x', 'approved'),
      returnLibraryLoanAction('../x'),
      checkLibraryClearanceAction('../x'),
    ]);
    for (const result of results) {
      expect(result.status).toBe('error');
    }
    expect(communication.confirmEmergencyBlast).not.toHaveBeenCalled();
    expect(communication.dispatchEmergencyBlast).not.toHaveBeenCalled();
    expect(communication.sendCircular).not.toHaveBeenCalled();
    expect(hostel.decideHostelLeave).not.toHaveBeenCalled();
    expect(library.returnLibraryLoan).not.toHaveBeenCalled();
    expect(library.getLibraryClearance).not.toHaveBeenCalled();
  });

  it('rejects a leave whose end precedes its start', async () => {
    const result = await createHostelLeaveAction({
      studentId: ID,
      hostelId: ID,
      startDate: '2026-05-10',
      endDate: '2026-05-01',
    });
    expect(result.status).toBe('error');
    expect(hostel.createHostelLeave).not.toHaveBeenCalled();
  });

  it('requires gate pass return after departure', () => {
    expect(
      gatePassWindowSchema.safeParse({
        expectedOutAt: '2026-05-01T18:00:00Z',
        expectedInAt: '2026-05-01T10:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      gatePassWindowSchema.safeParse({
        expectedOutAt: '2026-05-01T10:00:00Z',
        expectedInAt: '2026-05-01T18:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('passes valid input through', async () => {
    communication.dispatchEmergencyBlast.mockResolvedValue({
      id: ID,
      delivery: { mode: 'sandbox', honestyNote: 'n' },
    });
    const result = await dispatchEmergencyBlastAction(ID);
    expect(result.status).toBe('success');
    expect(communication.dispatchEmergencyBlast).toHaveBeenCalledWith(ID);
  });
});
