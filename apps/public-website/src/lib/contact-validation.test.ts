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
  it('rejects CR/LF header-injection style names and organizations', () => {
    const name = validateContactInput({ ...valid, name: 'a\r\nBcc:x' });
    expect(name.ok).toBe(false);
    if (!name.ok) expect(name.errors.name).toMatch(/single line/);
    const org = validateContactInput({ ...valid, organization: 'Org\nX-Injected: 1' });
    expect(org.ok).toBe(false);
    if (!org.ok) expect(org.errors.organization).toMatch(/single line/);
    expect(validateContactInput({ ...valid, name: 'Ada\u0000' }).ok).toBe(false);
  });
  it('keeps message newlines but strips other control characters', () => {
    const result = validateContactInput({
      ...valid,
      message: 'Line one\r\nLine two\u0007 with bell\u001b[31m',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.message).toBe('Line one\nLine two with bell[31m');
  });
  it('uses stricter email validation', () => {
    for (const email of [
      'a@b.c',
      'a..b@example.org',
      'a@-x.org',
      'a@x.123',
      'a b@x.org',
      'a\r\n@x.org',
    ]) {
      expect(validateContactInput({ ...valid, email }).ok, email).toBe(false);
    }
    for (const email of [
      'first.last+tag@sub.example.co.in',
      "o'neil@example.org",
      'a@xn--p1ai.xn--p1ai',
    ]) {
      expect(validateContactInput({ ...valid, email }).ok, email).toBe(true);
    }
  });
});
