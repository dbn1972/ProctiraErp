import { describe, expect, it } from 'vitest';

import { registrationErrorMessage } from './error-messages';

const labels: Record<string, string> = {
  'common.required': 'Required',
  'registration.invalidDateOfBirth': 'Enter a valid date of birth.',
  'errors.validation': 'Check the form.',
  'errors.unknown': 'Something went wrong.',
  'registration.configMissingMessage': 'Form not published.',
};

const t = (key: string) => labels[key] ?? key;

describe('registrationErrorMessage', () => {
  it('translates client and API codes', () => {
    expect(registrationErrorMessage(t, 'invalid_date')).toBe('Enter a valid date of birth.');
    expect(registrationErrorMessage(t, { code: 'VALIDATION_ERROR' })).toBe('Check the form.');
    expect(registrationErrorMessage(t, { rule: 'required', message: 'required' })).toBe('Required');
  });

  it('keeps a human sentence and hides unknown codes', () => {
    expect(
      registrationErrorMessage(t, { message: 'Select a valid institution', rule: 'uuid' }),
    ).toBe('Select a valid institution');
    expect(registrationErrorMessage(t, { code: 'MYSTERY_CODE' })).toBe('Something went wrong.');
  });
});
