import { describe, expect, it } from 'vitest';

import { nextApplicationStatuses, requiresConfirmation } from './status-transitions';

describe('admissions status transitions (PRC-L031)', () => {
  it('offers only valid next states', () => {
    expect(nextApplicationStatuses('pending')).toEqual(['under_review', 'waitlisted', 'rejected']);
    expect(nextApplicationStatuses('pending')).not.toContain('approved');
    expect(nextApplicationStatuses('approved')).toEqual([]);
    expect(nextApplicationStatuses('rejected')).toEqual([]);
    expect(nextApplicationStatuses('unknown')).toEqual([]);
  });

  it('requires confirmation for final decisions only', () => {
    expect(requiresConfirmation('approved')).toBe(true);
    expect(requiresConfirmation('rejected')).toBe(true);
    expect(requiresConfirmation('waitlisted')).toBe(false);
  });
});
