import { describe, expect, it } from 'vitest';

import { formatQuotaLabel, resolveQuotaFromForm } from './quota-categories';

describe('quota-categories', () => {
  it('resolves preset keys and custom keys', () => {
    expect(resolveQuotaFromForm('ews', '')).toBe('ews');
    expect(resolveQuotaFromForm('custom', ' defence_ward ')).toBe('defence_ward');
    expect(resolveQuotaFromForm('custom', '')).toBe('general');
  });

  it('formats known labels and passes through unknown keys', () => {
    expect(formatQuotaLabel('staff_ward')).toBe('Staff ward');
    expect(formatQuotaLabel('defence_ward')).toBe('defence_ward');
  });
});
