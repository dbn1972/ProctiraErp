import { describe, expect, it } from 'vitest';

import { CONTACT_LIMITS, validateContactInput } from './contact-validation';

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.edu',
  organization: 'Analytical Engines',
  message: 'We would like a district pilot starting next term.',
};

describe('validateContactInput', () => {
  it('accepts a well-formed payload', () => {
    const result = validateContactInput(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(valid);
    }
  });

  it('trims whitespace', () => {
    const result = validateContactInput({
      name: '  Ada  ',
      email: '  ada@example.edu ',
      organization: '  Org ',
      message: '  Enough characters here.  ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Ada');
      expect(result.value.email).toBe('ada@example.edu');
      expect(result.value.organization).toBe('Org');
      expect(result.value.message).toBe('Enough characters here.');
    }
  });

  it('rejects missing name', () => {
    const result = validateContactInput({ ...valid, name: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toMatch(/required/i);
  });

  it('rejects invalid email', () => {
    const result = validateContactInput({ ...valid, email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toMatch(/valid email/i);
  });

  it('rejects short messages', () => {
    const result = validateContactInput({ ...valid, message: 'too short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.message).toMatch(/at least/i);
  });

  it('rejects over-long fields', () => {
    const result = validateContactInput({
      ...valid,
      name: 'x'.repeat(CONTACT_LIMITS.nameMax + 1),
      message: 'y'.repeat(CONTACT_LIMITS.messageMax + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toMatch(/at most/i);
      expect(result.errors.message).toMatch(/at most/i);
    }
  });

  it('rejects filled honeypot', () => {
    const result = validateContactInput({ ...valid, website: 'http://spam.example' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.form).toMatch(/unable/i);
  });

  it('treats non-string fields as empty', () => {
    const result = validateContactInput({
      name: 42,
      email: null,
      message: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toBeDefined();
      expect(result.errors.email).toBeDefined();
      expect(result.errors.message).toBeDefined();
    }
  });
});
