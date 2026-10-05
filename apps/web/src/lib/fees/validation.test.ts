/** PRC-L025: fee form schemas reject empty/zero amounts and incomplete inputs. */
import { describe, expect, it } from 'vitest';
import {
  bulkInvoiceFormSchema,
  concessionFormSchema,
  feeStructureFormSchema,
  MAX_FEE_AMOUNT,
} from './validation';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const STRUCTURE = '22222222-2222-4222-8222-222222222222';

const structureBase = { name: 'Tuition', category: 'tuition' };

describe('feeStructureFormSchema amount', () => {
  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['zero', '0'],
    ['negative', '-5'],
    ['non-numeric', 'abc'],
    ['above max', String(MAX_FEE_AMOUNT + 1)],
  ])('rejects %s', (_label, amount) => {
    expect(feeStructureFormSchema.safeParse({ ...structureBase, amount }).success).toBe(false);
  });

  it('rejects a missing amount', () => {
    expect(feeStructureFormSchema.safeParse(structureBase).success).toBe(false);
  });

  it('accepts a positive amount and coerces it to a number', () => {
    const parsed = feeStructureFormSchema.safeParse({ ...structureBase, amount: '1500.50' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.amount).toBe(1500.5);
  });
});

describe('bulkInvoiceFormSchema', () => {
  it('rejects a non-UUID student id in the list', () => {
    const parsed = bulkInvoiceFormSchema.safeParse({
      structureId: STRUCTURE,
      studentIds: `${STUDENT}, not-a-uuid`,
    });
    expect(parsed.success).toBe(false);
  });

  it.each(['2026-13-01', '2026-02-30', '14/10/2026', 'tomorrow'])(
    'rejects invalid due date %s',
    (dueAt) => {
      expect(bulkInvoiceFormSchema.safeParse({ structureId: STRUCTURE, dueAt }).success).toBe(
        false,
      );
    },
  );

  it('accepts UUID lists, an ISO date, and blank optional fields', () => {
    expect(
      bulkInvoiceFormSchema.safeParse({
        structureId: STRUCTURE,
        studentIds: `${STUDENT}\n${STRUCTURE}`,
        dueAt: '2026-10-14',
      }).success,
    ).toBe(true);
    expect(
      bulkInvoiceFormSchema.safeParse({
        structureId: STRUCTURE,
        classId: STUDENT,
        studentIds: '',
        dueAt: '',
      }).success,
    ).toBe(true);
  });

  it('PRC-M086: rejects a run with no class, students or class-scoped structure', () => {
    const parsed = bulkInvoiceFormSchema.safeParse({
      structureId: STRUCTURE,
      classId: '',
      studentIds: '',
      dueAt: '',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/class or add students/);
    expect(
      bulkInvoiceFormSchema.safeParse({ structureId: STRUCTURE, structureScoped: true }).success,
    ).toBe(true);
  });
});

describe('concessionFormSchema', () => {
  const base = { studentId: STUDENT, structureId: STRUCTURE, reason: 'Sibling discount' };

  it.each([
    ['percent kind without percent', { kind: 'percent' }],
    ['percent kind with empty percent', { kind: 'percent', percent: '' }],
    ['percent kind with zero percent', { kind: 'percent', percent: '0' }],
    ['percent kind over 100', { kind: 'percent', percent: '101' }],
    ['amount kind without amount', { kind: 'amount' }],
    ['amount kind with empty amount', { kind: 'amount', amount: '' }],
    ['amount kind with zero amount', { kind: 'amount', amount: '0' }],
  ])('rejects %s', (_label, extra) => {
    expect(concessionFormSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });

  it('accepts a complete percent or amount concession', () => {
    expect(
      concessionFormSchema.safeParse({ ...base, kind: 'percent', percent: '10' }).success,
    ).toBe(true);
    expect(concessionFormSchema.safeParse({ ...base, kind: 'amount', amount: '500' }).success).toBe(
      true,
    );
  });
});
