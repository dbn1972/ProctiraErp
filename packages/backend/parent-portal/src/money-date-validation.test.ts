/**
 * PRC-M317: money and date inputs must be strongly validated at the schema boundary
 * so fractional/huge amounts or unparseable dates are rejected with 400, not 500.
 */
import { validate } from '@proctira/validation';
import { describe, expect, it } from 'vitest';

import { CreateFeePlanSchema, CreateInvoiceSchema } from './schemas.js';

const STUDENT_ID = '00000000-0000-4000-8000-000000000099';

describe('parent-portal money/date validation (PRC-M317)', () => {
  it('rejects a fractional amountCents on a fee plan', () => {
    const result = validate(CreateFeePlanSchema, { name: 'Tuition', amountCents: 100.5 });
    expect(result.success).toBe(false);
  });

  it('rejects a huge amountCents on a fee plan', () => {
    const result = validate(CreateFeePlanSchema, { name: 'Tuition', amountCents: 1e18 });
    expect(result.success).toBe(false);
  });

  it('accepts an integer amountCents', () => {
    const result = validate(CreateFeePlanSchema, { name: 'Tuition', amountCents: 150000 });
    expect(result.success).toBe(true);
  });

  it('rejects an unparseable dueAt on an invoice', () => {
    const result = validate(CreateInvoiceSchema, {
      studentId: STUDENT_ID,
      amountCents: 1000,
      dueAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an ISO-8601 date-time dueAt', () => {
    const result = validate(CreateInvoiceSchema, {
      studentId: STUDENT_ID,
      amountCents: 1000,
      dueAt: '2026-10-09T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a fractional invoice amountCents', () => {
    const result = validate(CreateInvoiceSchema, {
      studentId: STUDENT_ID,
      amountCents: 10.25,
    });
    expect(result.success).toBe(false);
  });
});
