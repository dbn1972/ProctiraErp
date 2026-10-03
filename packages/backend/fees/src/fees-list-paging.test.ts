import { describe, expect, it } from 'vitest';
import { pageFeeList } from './fees-plugin';

type Row = { id: number; status: string; studentId: string };
const rows: Row[] = Array.from({ length: 10_000 }, (_, i) => ({
  id: i,
  status: i % 2 === 0 ? 'open' : 'paid',
  studentId: `s-${i % 7}`,
}));
const match = { status: (r: Row) => r.status, studentId: (r: Row) => r.studentId };

describe('PRC-M477 fee list paging', () => {
  it('returns everything when no paging params are sent (back-compat)', () => {
    const out = pageFeeList(rows, {}, match);
    expect(out.data).toHaveLength(10_000);
    expect(out.meta).toBeUndefined();
  });

  it('bounds 10k invoices to one page with meta', () => {
    const out = pageFeeList(rows, { page: '3', pageSize: '50' }, match);
    expect(out.data).toHaveLength(50);
    expect(out.data[0]!.id).toBe(100);
    expect(out.meta).toEqual({ page: 3, pageSize: 50, totalItems: 10_000, totalPages: 200 });
  });

  it('filters by status and student before paging', () => {
    const out = pageFeeList(rows, { page: '1', pageSize: '20', status: 'open', studentId: 's-0' }, match);
    expect(out.data.every((r) => r.status === 'open' && r.studentId === 's-0')).toBe(true);
    expect(out.meta!.totalItems).toBe(rows.filter((r) => r.status === 'open' && r.studentId === 's-0').length);
  });

  it('clamps pageSize to 100', () => {
    expect(pageFeeList(rows, { pageSize: '1000' }, match).data).toHaveLength(100);
  });
});
