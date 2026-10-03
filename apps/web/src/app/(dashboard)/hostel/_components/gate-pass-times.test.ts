/**
 * PRC-M478: gate pass times are instants with an explicit offset. The form converts
 * datetime-local in the tenant timezone; the action rejects naive strings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const createHostelGatePass = vi.fn();
vi.mock('@/lib/api/hostel', () => ({ createHostelGatePass: (i: unknown) => createHostelGatePass(i) }));
vi.mock('@/lib/api/library', () => ({}));
vi.mock('@/lib/load-entity-labels', () => ({ loadStudentOptions: vi.fn(async () => []) }));

import { zonedLocalToUtcIso } from '@/lib/datetime/zoned';
import { requestGatePassAction } from '../../campus-ops-actions';

const ID = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';

beforeEach(() => createHostelGatePass.mockReset().mockResolvedValue({ id: ID }));

describe('gate pass times (PRC-M478)', () => {
  it('18:00 entered in IST is stored as 12:30Z', () => {
    expect(zonedLocalToUtcIso('2026-09-10T18:00', 'Asia/Kolkata')).toBe('2026-09-10T12:30:00.000Z');
  });

  it('rejects naive datetime-local strings without calling the API', async () => {
    const r = await requestGatePassAction({
      hostelId: ID,
      studentId: ID,
      expectedOutAt: '2026-09-10T18:00',
      expectedInAt: '2026-09-10T20:00',
    });
    expect(r.status).toBe('error');
    expect(createHostelGatePass).not.toHaveBeenCalled();
  });

  it('rejects a return before departure', async () => {
    const r = await requestGatePassAction({
      hostelId: ID,
      studentId: ID,
      expectedOutAt: '2026-09-10T12:30:00.000Z',
      expectedInAt: '2026-09-10T10:00:00.000Z',
    });
    expect(r.status).toBe('error');
    expect(createHostelGatePass).not.toHaveBeenCalled();
  });

  it('forwards offset instants', async () => {
    const r = await requestGatePassAction({
      hostelId: ID,
      studentId: ID,
      expectedOutAt: '2026-09-10T12:30:00.000Z',
      expectedInAt: '2026-09-10T21:00:00+05:30',
    });
    expect(r.status).toBe('success');
    expect(createHostelGatePass).toHaveBeenCalled();
  });
});
