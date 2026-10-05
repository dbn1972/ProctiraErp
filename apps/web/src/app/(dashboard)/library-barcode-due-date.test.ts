/**
 * PRC-M104 — barcode checkout forwards the clerk's due date (end of the
 * tenant-local day) and refuses past dates before the gateway call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkoutLibraryByBarcode = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/admin.server', () => ({
  getTenantSettings: vi.fn(async () => ({
    settings: { timezone: 'Asia/Kolkata' },
    source: 'gateway',
  })),
}));
vi.mock('@/lib/api/library', () => ({
  checkoutLibraryByBarcode: (...args: unknown[]) => checkoutLibraryByBarcode(...args),
}));
vi.mock('@/lib/api/hostel', () => ({}));
vi.mock('@/lib/load-entity-labels', () => ({ loadStudentOptions: vi.fn() }));

import { checkoutBarcodeAction } from './campus-ops-actions';

describe('barcode checkout due date (PRC-M104)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z'), toFake: ['Date'] });
    checkoutLibraryByBarcode.mockReset().mockResolvedValue({ id: 'loan-1' });
  });
  afterEach(() => vi.useRealTimers());

  it('sends the selected due date', async () => {
    const result = await checkoutBarcodeAction({ barcode: 'BC-1', dueAt: '2026-01-10' });
    expect(result.status).toBe('success');
    expect(checkoutLibraryByBarcode.mock.calls[0]?.[0].dueAt).toBe('2026-01-10T18:29:59.000Z');
  });

  it('rejects a past due date without calling the gateway', async () => {
    const result = await checkoutBarcodeAction({ barcode: 'BC-1', dueAt: '2025-12-01' });
    expect(result).toMatchObject({ status: 'error', message: 'Due date cannot be in the past.' });
    expect(checkoutLibraryByBarcode).not.toHaveBeenCalled();
  });

  it('omits dueAt when none is chosen (server default applies)', async () => {
    await checkoutBarcodeAction({ barcode: 'BC-1' });
    expect(checkoutLibraryByBarcode.mock.calls[0]?.[0].dueAt).toBeUndefined();
  });
});
