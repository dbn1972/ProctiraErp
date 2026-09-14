/**
 * W1-DATA-13 — PgEnrollmentRepository history discovery uses platform scope
 * (never unbound pool.query), then withPgTenant for history rows.
 */
import { describe, expect, it, vi } from 'vitest';

import { PgEnrollmentRepository } from './pg-enrollment-repository.js';

describe('W1-DATA-13 getHistoryByEnrollmentId tenant helper', () => {
  it('binds platform_admin then app.tenant_id; never calls pool.query unbound', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const enrollmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const tenantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return { rows: [] };
        }
        if (text.includes("set_config('app.platform_admin'")) {
          return { rows: [] };
        }
        if (text.includes("set_config('app.tenant_id'")) {
          return { rows: [] };
        }
        if (text.includes("set_config('app.current_tenant_id'")) {
          return { rows: [] };
        }
        if (text.includes('FROM enrollments')) {
          return { rows: [{ tenant_id: tenantId }] };
        }
        if (text.includes('FROM enrollment_history')) {
          return {
            rows: [
              {
                id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                tenant_id: tenantId,
                enrollment_id: enrollmentId,
                previous_status: null,
                new_status: 'active',
                effective_date: new Date('2026-01-01'),
                institution_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                academic_period_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                reason: null,
                created_at: new Date('2026-01-01'),
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const pool = {
      query: vi.fn(async () => {
        throw new Error('unbound pool.query must not be used');
      }),
      connect: vi.fn(async () => client),
    };

    const repo = new PgEnrollmentRepository(pool as never);
    const history = await repo.getHistoryByEnrollmentId(enrollmentId);

    expect(pool.query).not.toHaveBeenCalled();
    expect(history).toHaveLength(1);
    expect(history[0]?.tenantId).toBe(tenantId);

    const texts = queries.map((q) => q.text);
    expect(texts.some((t) => t.includes("set_config('app.platform_admin'"))).toBe(true);
    expect(texts.some((t) => t.includes("set_config('app.tenant_id'"))).toBe(true);
  });

  it('returns [] when enrollment is unknown (platform-scoped miss)', async () => {
    const client = {
      query: vi.fn(async (text: string) => {
        if (text === 'BEGIN' || text === 'COMMIT' || text.includes('set_config')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async () => {
        throw new Error('unbound pool.query must not be used');
      }),
      connect: vi.fn(async () => client),
    };
    const repo = new PgEnrollmentRepository(pool as never);
    await expect(repo.getHistoryByEnrollmentId('missing')).resolves.toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
