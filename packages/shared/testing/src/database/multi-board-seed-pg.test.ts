/**
 * PRC-L497 unit checks of the Postgres seed adapter (no database needed):
 * tenant-only binding, no platform escape, fail-closed tenant check, rollback.
 * The live RLS proof is packages/shared/database/src/multi-board-seed-pg.live.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { seedMultiBoardSchools } from './multi-board-seed.js';
import {
  persistMultiBoardSeed,
  SeedTenantMismatchError,
  type SeedPgPool,
} from './multi-board-seed-pg.js';
function recordingPool(failOn?: RegExp) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  let released = 0;
  const pool: SeedPgPool = {
    connect: async () => ({
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        if (failOn && failOn.test(text)) throw Object.assign(new Error('boom'), { code: '23505' });
        if (text.includes('COUNT(*)')) return { rows: [{ c: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
      release: () => {
        released += 1;
      },
    }),
  };
  return { pool, calls, released: () => released };
}
const small = () =>
  seedMultiBoardSchools({
    studentsPerSchool: 2,
    staffPerSchool: 1,
    boards: [
      {
        boardCode: 'B1',
        boardName: 'Board',
        boardType: 'STATE',
        schools: [{ code: 'S1', name: 'School' }],
      },
    ],
  });
describe('PRC-L497 persistMultiBoardSeed', () => {
  it('binds only app.tenant_id (transaction-local) before any write; never the platform escape', async () => {
    const seed = small();
    const { pool, calls, released } = recordingPool();
    await persistMultiBoardSeed(pool, seed);
    const texts = calls.map((c) => c.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts[1]).toContain("set_config('app.tenant_id', $1, true)");
    expect(calls[1]!.values).toEqual([seed.tenant.id]);
    expect(texts.some((t) => t.includes('platform_admin'))).toBe(false);
    const firstInsert = texts.findIndex((t) => t.includes('INSERT'));
    expect(firstInsert).toBeGreaterThan(1);
    expect(texts[texts.length - 1]).toBe('COMMIT');
    expect(released()).toBe(1);
  });
  it('refuses a fixture row owned by another tenant before connecting', async () => {
    const seed = small();
    seed.schools[0]!.enrollments[0]!.tenantId = 'other-tenant';
    const { pool, calls } = recordingPool();
    await expect(persistMultiBoardSeed(pool, seed)).rejects.toBeInstanceOf(SeedTenantMismatchError);
    expect(calls).toHaveLength(0);
  });
  it('rolls back and releases the client when a write fails', async () => {
    const { pool, calls, released } = recordingPool(/INSERT INTO staff/);
    await expect(persistMultiBoardSeed(pool, small())).rejects.toThrow('boom');
    expect(calls.map((c) => c.text)).toContain('ROLLBACK');
    expect(calls.map((c) => c.text)).not.toContain('COMMIT');
    expect(released()).toBe(1);
  });
});
