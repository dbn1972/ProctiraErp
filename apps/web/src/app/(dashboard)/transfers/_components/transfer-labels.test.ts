import { describe, expect, it } from 'vitest';

import { transferPartyLabel } from './transfer-labels';

const STUDENT = '00000000-0000-4000-8000-00000000b751';

describe('transferPartyLabel', () => {
  it('uses the person name when the API resolved it', () => {
    expect(transferPartyLabel(STUDENT, 'Aarav Transfer', 'Student')).toBe('Aarav Transfer');
  });

  it('does not show a raw UUID when the name is missing', () => {
    const label = transferPartyLabel(STUDENT, null, 'Student');
    expect(label.startsWith('Student ')).toBe(true);
    expect(label).not.toBe(STUDENT);
    expect(label.includes(STUDENT)).toBe(false);
  });
});
