/**
 * PRC-L047 — due dates are converted with the tenant timezone on the server,
 * regardless of the browser/host timezone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAssignment = vi.fn();
const checkoutLibraryItem = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/admin.server', () => ({
  getTenantSettings: vi.fn(async () => ({
    settings: { timezone: 'Asia/Kolkata' },
    source: 'gateway',
  })),
}));
vi.mock('@/lib/api/lms', () => ({
  createAssignment: (...args: unknown[]) => createAssignment(...args),
}));
vi.mock('@/lib/api/library', () => ({
  checkoutLibraryItem: (...args: unknown[]) => checkoutLibraryItem(...args),
}));
vi.mock('@/lib/api/hostel', () => ({}));

import { createAssignmentAction } from './lms/actions';
import { checkoutLibraryItemAction } from './campus-actions';

describe('due dates use the tenant timezone (PRC-L047)', () => {
  beforeEach(() => {
    createAssignment.mockReset().mockResolvedValue({ id: 'a1' });
    checkoutLibraryItem.mockReset().mockResolvedValue({ id: 'l1' });
  });

  it('assignment deadline 17:00 IST stores 11:30Z', async () => {
    const result = await createAssignmentAction({
      scope: 'school',
      // PRC-L24x (#532): school-scoped assignments need their institution.
      institutionId: '01890a5d-ac96-774b-bcce-b302099a8058',
      kind: 'assignment',
      title: 'T',
      subject: 'S',
      maxScore: 10,
      dueAt: '2026-01-10T17:00',
    } as Parameters<typeof createAssignmentAction>[0]);
    expect(result.status).toBe('success');
    expect(createAssignment.mock.calls[0]?.[0].dueAt).toBe('2026-01-10T11:30:00.000Z');
  });

  it('library due date resolves to end of the tenant-local day', async () => {
    // PRC-M104: past due dates are refused, so pin "now" before the due date.
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z'), toFake: ['Date'] });
    await checkoutLibraryItemAction({
      // PRC-L033: the action validates ids before the gateway call.
      itemId: '01890a5d-ac96-774b-bcce-b302099a8057',
      dueAt: '2026-01-10',
    });
    expect(checkoutLibraryItem.mock.calls[0]?.[0].dueAt).toBe('2026-01-10T18:29:59.000Z');
    vi.useRealTimers();
  });

  it('rejects an unparseable deadline instead of storing it', async () => {
    const result = await createAssignmentAction({
      scope: 'school',
      institutionId: '01890a5d-ac96-774b-bcce-b302099a8058',
      kind: 'assignment',
      title: 'T',
      subject: 'S',
      maxScore: 10,
      dueAt: 'not-a-date',
    } as Parameters<typeof createAssignmentAction>[0]);
    expect(result.status).toBe('error');
    expect(createAssignment).not.toHaveBeenCalled();
  });
});
