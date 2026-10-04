/**
 * PRC-H022 — the route institution is an authorization boundary.
 * A section owned by another institution must 404, and facility updates must
 * carry the route institution so the gateway/handler can reject foreign ids.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const getSection = vi.fn();
vi.mock('@/lib/api/timetable', () => ({
  getSection,
  listPeriods: vi.fn(async () => ({ ok: true, data: [] })),
  listRooms: vi.fn(async () => ({ ok: true, data: [] })),
  listBellSchedules: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock('@/lib/api/staff', () => ({ getStaff: vi.fn(), listStaff: vi.fn() }));
vi.mock('@/lib/api/students', () => ({ getStudent: vi.fn(), listStudents: vi.fn() }));
vi.mock('@/components/timetable/section-roster-controls', () => ({
  SectionBulkEnrollForm: () => null,
  SectionEnrollForm: () => null,
  SectionPublishControls: () => null,
  WithdrawStudentButton: () => null,
}));

const gatewayFetch = vi.fn();
vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch,
  GatewayError: class GatewayError extends Error {},
}));

describe('PRC-H022 institution scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for a section that belongs to another institution', async () => {
    getSection.mockResolvedValue({
      ok: true,
      data: { id: 'sec-b', institutionId: 'inst-B', enrollments: [], meetings: [] },
    });
    const { default: SectionRosterPage } = await import('./page');
    await expect(
      SectionRosterPage({ params: Promise.resolve({ id: 'inst-A', sectionId: 'sec-b' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('scopes facility updates to the route institution', async () => {
    gatewayFetch.mockResolvedValue({ ok: false, error: { message: 'Not found' } });
    const { updateFacilityAction } = await import('../../infrastructure/actions');
    // PRC-L241: ids must be UUIDs before the gateway call.
    const INST_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
    const FACILITY_OF_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
    const result = await updateFacilityAction({
      institutionId: INST_A,
      id: FACILITY_OF_B,
      name: 'x',
      capacity: 1,
      condition: 'Good',
    });
    expect(result).toEqual({ ok: false, error: 'Not found' });
    expect(gatewayFetch).toHaveBeenCalledWith(
      `/infrastructure/${FACILITY_OF_B}?institutionId=${INST_A}`,
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
