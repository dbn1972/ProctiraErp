import { describe, expect, it } from 'vitest';

import { decideTrackLookup } from './track-lookup';

describe('decideTrackLookup', () => {
  it('accepts a normalized tracking number and a calendar date', () => {
    expect(decideTrackLookup('reg-a1b2c3d4', '2015-03-02')).toEqual({
      ok: true,
      trackingNumber: 'REG-A1B2C3D4',
      dob: '2015-03-02',
    });
  });

  it('rejects a missing or impossible date of birth', () => {
    expect(decideTrackLookup('REG-A1B2C3D4', '')).toEqual({ ok: false });
    expect(decideTrackLookup('REG-A1B2C3D4', '2015-02-31')).toEqual({ ok: false });
  });
});
