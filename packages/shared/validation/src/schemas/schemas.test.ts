import { Value } from '@sinclair/typebox/value';
import { describe, it, expect } from 'vitest';

import { DateSchema } from './date';
import { EmailSchema } from './email';
import { NameSchema } from './name';
import { PaginationSchema } from './pagination';
import { PhoneSchema } from './phone';
import { UuidSchema } from './uuid';

describe('UuidSchema', () => {
  it('accepts a valid UUID v4', () => {
    expect(Value.Check(UuidSchema, '550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts lowercase UUID v4', () => {
    expect(Value.Check(UuidSchema, 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true);
  });

  it('rejects an invalid UUID', () => {
    expect(Value.Check(UuidSchema, 'not-a-uuid')).toBe(false);
  });

  it('rejects UUID v1 (wrong version digit)', () => {
    expect(Value.Check(UuidSchema, '550e8400-e29b-11d4-a716-446655440000')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(Value.Check(UuidSchema, '')).toBe(false);
  });

  it('rejects non-string types', () => {
    expect(Value.Check(UuidSchema, 123)).toBe(false);
    expect(Value.Check(UuidSchema, null)).toBe(false);
  });
});

describe('EmailSchema', () => {
  it('accepts a valid email', () => {
    expect(Value.Check(EmailSchema, 'user@example.com')).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(Value.Check(EmailSchema, 'admin@mail.school.edu')).toBe(true);
  });

  it('rejects email without @', () => {
    expect(Value.Check(EmailSchema, 'userexample.com')).toBe(false);
  });

  it('rejects email without domain', () => {
    expect(Value.Check(EmailSchema, 'user@')).toBe(false);
  });

  it('rejects email with spaces', () => {
    expect(Value.Check(EmailSchema, 'user @example.com')).toBe(false);
  });

  it('rejects email exceeding 254 characters', () => {
    const longEmail = 'a'.repeat(246) + '@test.com'; // 246 + 9 = 255 > 254
    expect(Value.Check(EmailSchema, longEmail)).toBe(false);
  });
});

describe('DateSchema', () => {
  it('accepts a valid ISO date', () => {
    expect(Value.Check(DateSchema, '2024-01-15')).toBe(true);
  });

  it('accepts end-of-month date', () => {
    expect(Value.Check(DateSchema, '2024-12-31')).toBe(true);
  });

  it('rejects invalid month', () => {
    expect(Value.Check(DateSchema, '2024-13-01')).toBe(false);
  });

  it('rejects invalid day', () => {
    expect(Value.Check(DateSchema, '2024-01-32')).toBe(false);
  });

  it('rejects non-ISO format', () => {
    expect(Value.Check(DateSchema, '15/01/2024')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(Value.Check(DateSchema, '')).toBe(false);
  });
});

describe('PaginationSchema', () => {
  it('accepts valid pagination params', () => {
    expect(Value.Check(PaginationSchema, { page: 1, pageSize: 20 })).toBe(true);
  });

  it('accepts page at boundary', () => {
    expect(Value.Check(PaginationSchema, { page: 1, pageSize: 100 })).toBe(true);
  });

  it('rejects page less than 1', () => {
    expect(Value.Check(PaginationSchema, { page: 0, pageSize: 20 })).toBe(false);
  });

  it('rejects pageSize exceeding max', () => {
    expect(Value.Check(PaginationSchema, { page: 1, pageSize: 101 })).toBe(false);
  });

  it('rejects pageSize less than 1', () => {
    expect(Value.Check(PaginationSchema, { page: 1, pageSize: 0 })).toBe(false);
  });

  it('rejects non-numeric values', () => {
    expect(Value.Check(PaginationSchema, { page: 'one', pageSize: 20 })).toBe(false);
  });
});

describe('PhoneSchema', () => {
  it('accepts international format with +', () => {
    expect(Value.Check(PhoneSchema, '+1-555-123-4567')).toBe(true);
  });

  it('accepts format with parentheses', () => {
    expect(Value.Check(PhoneSchema, '(555) 123-4567')).toBe(true);
  });

  it('accepts plain digits', () => {
    expect(Value.Check(PhoneSchema, '5551234567')).toBe(true);
  });

  it('rejects too short number', () => {
    expect(Value.Check(PhoneSchema, '12345')).toBe(false);
  });

  it('rejects too long number', () => {
    expect(Value.Check(PhoneSchema, '123456789012345678901')).toBe(false);
  });

  it('rejects letters', () => {
    expect(Value.Check(PhoneSchema, '+1-555-ABC-4567')).toBe(false);
  });
});

describe('NameSchema', () => {
  it('accepts a valid name', () => {
    expect(Value.Check(NameSchema, 'John Doe')).toBe(true);
  });

  it('accepts single character', () => {
    expect(Value.Check(NameSchema, 'A')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(Value.Check(NameSchema, '')).toBe(false);
  });

  it('rejects string exceeding 255 characters', () => {
    expect(Value.Check(NameSchema, 'A'.repeat(256))).toBe(false);
  });

  it('accepts exactly 255 characters', () => {
    expect(Value.Check(NameSchema, 'A'.repeat(255))).toBe(true);
  });
});
