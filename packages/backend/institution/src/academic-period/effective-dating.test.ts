import { describe, expect, it } from 'vitest';

import { isEffectiveOn, toUtcDateOnly } from './effective-dating.js';

describe('W1-DATA-07 academic period effective dating', () => {
  it('includes the as-of day inside start/end (valid_from/valid_to equivalent)', () => {
    expect(isEffectiveOn('2025-01-01', '2025-12-31', '2025-06-15')).toBe(true);
    expect(isEffectiveOn('2025-01-01', '2025-12-31', '2025-01-01')).toBe(true);
    expect(isEffectiveOn('2025-01-01', '2025-12-31', '2025-12-31')).toBe(true);
  });

  it('excludes dates outside the window', () => {
    expect(isEffectiveOn('2025-01-01', '2025-12-31', '2024-12-31')).toBe(false);
    expect(isEffectiveOn('2025-01-01', '2025-12-31', '2026-01-01')).toBe(false);
  });

  it('normalizes Date inputs to UTC date-only', () => {
    expect(toUtcDateOnly(new Date('2025-09-14T15:30:00.000Z'))).toBe('2025-09-14');
  });
});
