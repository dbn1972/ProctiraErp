/**
 * PRC-L238 — concession input must not silently apply a 0% / out-of-range discount.
 */
import { describe, expect, it } from 'vitest';
import { concessionFormSchema } from './validation';

const ID = '11111111-1111-4111-8111-111111111111';
const base = { studentId: ID, structureId: ID, invoiceId: ID, reason: 'Sibling discount' };

function issuesFor(input: Record<string, unknown>) {
  const r = concessionFormSchema.safeParse({ ...base, ...input });
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

describe('concessionFormSchema (PRC-L238)', () => {
  it('rejects a blank percent with a percent field error', () => {
    expect(issuesFor({ kind: 'percent', percent: undefined })).toContain('percent');
  });
  it('rejects 0% and 101%', () => {
    expect(issuesFor({ kind: 'percent', percent: 0 })).toContain('percent');
    expect(issuesFor({ kind: 'percent', percent: 101 })).toContain('percent');
  });
  it('accepts 10% and 100%', () => {
    expect(issuesFor({ kind: 'percent', percent: 10 })).toEqual([]);
    expect(issuesFor({ kind: 'percent', percent: 100 })).toEqual([]);
  });
  it('amount concessions need amount > 0', () => {
    expect(issuesFor({ kind: 'amount', amount: 0 })).toContain('amount');
    expect(issuesFor({ kind: 'amount' })).toContain('amount');
    expect(issuesFor({ kind: 'amount', amount: 250 })).toEqual([]);
  });
  it('rejects a whitespace-only reason', () => {
    expect(issuesFor({ kind: 'percent', percent: 10, reason: '   ' })).toContain('reason');
  });
});
