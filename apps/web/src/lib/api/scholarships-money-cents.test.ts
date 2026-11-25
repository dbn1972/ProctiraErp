/**
 * PRC-L268 (D1): the scholarship client handles money as integer minor units. It
 * reads the gateway's `*Cents` fields, converts a major-unit value exactly, refuses
 * a malformed amount instead of turning it into 0, sends integer cents on writes
 * and sums totals in cents.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<typeof import('./gateway')>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import {
  createScholarshipProgram,
  gatewayMoneyCents,
  getScholarshipProgram,
  mapDisbursement,
  totalsByCurrency,
  updateScholarshipProgram,
} from './scholarships';

const PROGRAM = {
  id: 'p1',
  name: 'Merit',
  status: 'open',
  totalSlots: 10,
  currency: 'INR',
  applicationStartDate: '2026-01-01',
  applicationEndDate: '2026-02-01',
};

beforeEach(() => gatewayFetch.mockReset());

describe('scholarship money in minor units (PRC-L268)', () => {
  it('reads integer cents first and converts a major value exactly', async () => {
    gatewayFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...PROGRAM, amountPerRecipient: 1234.5, amountPerRecipientCents: 123_450 },
    });
    const program = await getScholarshipProgram('p1');
    expect(program).toMatchObject({ awardAmountCents: 123_450, awardAmount: 1234.5 });
    expect(mapDisbursement({ id: 'd1', amount: '19.99' }).amountCents).toBe(1_999);
    expect(mapDisbursement({ id: 'd2', amountCents: '250000', amount: 2500 }).amountCents).toBe(
      250_000,
    );
  });

  it('refuses a malformed or missing amount instead of silently using 0', () => {
    expect(() => mapDisbursement({ id: 'd1', amount: 'abc' })).toThrow(/malformed/);
    expect(() => mapDisbursement({ id: 'd1' })).toThrow(/malformed/);
    expect(() => gatewayMoneyCents(undefined, 10.005, 'x')).toThrow(/malformed/);
    expect(() => gatewayMoneyCents(-5, undefined, 'x')).toThrow(/malformed/);
  });

  it('sends integer amountPerRecipientCents on create and update', async () => {
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 201,
      data: { ...PROGRAM, amountPerRecipientCents: 1_010 },
    });
    await createScholarshipProgram({
      name: 'Merit',
      applicationStartDate: '2026-01-01',
      applicationEndDate: '2026-02-01',
      totalSlots: 10,
      awardAmount: 10.1,
    });
    const created = (gatewayFetch.mock.calls[0]![1] as { json: Record<string, unknown> }).json;
    expect(created.amountPerRecipientCents).toBe(1_010);
    expect(Number.isInteger(created.amountPerRecipientCents)).toBe(true);

    await updateScholarshipProgram('p1', { amountPerRecipient: 2500.25 });
    const updated = (gatewayFetch.mock.calls[1]![1] as { json: Record<string, unknown> }).json;
    expect(updated.amountPerRecipientCents).toBe(250_025);

    await expect(
      createScholarshipProgram({
        name: 'Bad',
        applicationStartDate: '2026-01-01',
        applicationEndDate: '2026-02-01',
        totalSlots: 1,
        awardAmount: 10.005,
      }),
    ).rejects.toThrow();
    expect(gatewayFetch).toHaveBeenCalledTimes(2);
  });

  it('sums totals in integer cents (no float drift)', () => {
    const rows = Array.from({ length: 3 }, () => ({ amountCents: 10, currency: 'INR' }));
    rows.push({ amountCents: 20, currency: 'INR' });
    expect(totalsByCurrency(rows)).toEqual([{ currency: 'INR', totalCents: 50, total: 0.5 }]);
  });
});
