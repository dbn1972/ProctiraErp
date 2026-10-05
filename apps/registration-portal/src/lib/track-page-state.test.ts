/**
 * PRC-M055 — tracking page states: outage / throttle are not "not found" and
 * a malformed URL is an invalid request rather than a crash.
 */
import { describe, expect, it } from 'vitest';
import { RegistrationApiError } from './api';
import { resolveTrackingPage, safeDecodeTrackingNumber } from './track-lookup';

const TN = 'REG-A1B2C3D4';
const DOB = '2014-01-02';

describe('PRC-M055 tracking page state', () => {
  it('mocked 503 renders unavailable, not notFound', async () => {
    const state = await resolveTrackingPage(TN, DOB, async () => {
      throw new RegistrationApiError('down', 503);
    });
    expect(state.kind).toBe('unavailable');
  });

  it('network failure -> unavailable; 429 -> rate_limited', async () => {
    expect(
      (
        await resolveTrackingPage(TN, DOB, async () => {
          throw new TypeError('fetch failed');
        })
      ).kind,
    ).toBe('unavailable');
    expect(
      (
        await resolveTrackingPage(TN, DOB, async () => {
          throw new RegistrationApiError('slow down', 429);
        })
      ).kind,
    ).toBe('rate_limited');
  });

  it('GET /track/%E0%A4%A -> invalid state, not a thrown URIError', async () => {
    expect(safeDecodeTrackingNumber('%E0%A4%A')).toBeNull();
    const state = await resolveTrackingPage('%E0%A4%A', DOB, async () => {
      throw new Error('must not be called');
    });
    expect(state).toEqual({ kind: 'invalid', trackingNumber: null });
  });

  it('no match -> not_found; match -> match', async () => {
    expect((await resolveTrackingPage(TN, DOB, async () => null)).kind).toBe('not_found');
    const match = await resolveTrackingPage(TN.toLowerCase(), DOB, async (tn) => ({ tn }));
    expect(match).toEqual({ kind: 'match', trackingNumber: TN, status: { tn: TN } });
  });
});
