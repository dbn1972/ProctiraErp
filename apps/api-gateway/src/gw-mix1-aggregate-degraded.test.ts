/**
 * PRC-M009 — aggregate endpoints must not turn DB failures into HTTP 200 zeros.
 * A throwing Postgres client yields 503 plus an error log line.
 */
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const failingClient = {
  query: vi.fn(async (sql: string) => {
    if (sql.includes('to_regclass')) return { rows: [{ reg: 'public.x' }] };
    if (sql.includes('information_schema')) return { rows: [] };
    throw new Error('connection terminated unexpectedly (db.internal:5432)');
  }),
};

vi.mock('@proctira/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/database')>();
  return {
    ...actual,
    getSharedPgPool: () => ({}) as never,
    withPgTenant: async (_pool: unknown, _tenant: string, fn: (c: unknown) => unknown) =>
      fn(failingClient),
  };
});

const { BoardSummaryUnavailableError, getBoardSummary } = await import('./board-summary.js');
const { insightsUiPlugin } = await import('./insights-ui-plugin.js');
const { registerInstitutionDirectoryRoutes, loadInstitutionDirectoryContext } = await import(
  './institution-directory.js'
);

describe('aggregate DB failures surface as 503 (PRC-M009)', () => {
  const saved = process.env['DATABASE_URL'];
  beforeEach(() => {
    process.env['DATABASE_URL'] = 'postgres://mock';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = saved;
  });

  it('getBoardSummary throws instead of returning zeros', async () => {
    await expect(getBoardSummary('board-a', 'tenant-1')).rejects.toBeInstanceOf(
      BoardSummaryUnavailableError,
    );
  });

  it('board summary route → 503 with an error log line and no driver text', async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: { level: 'error', stream: { write: (l: string) => lines.push(l) } },
    });
    app.addHook('onRequest', async (request) => {
      (request as { user?: unknown }).user = { roles: [{ roleId: 'admin' }] };
    });
    await app.register(insightsUiPlugin, { store: {} as never });
    const res = await app.inject({ method: 'GET', url: '/reports/board/board-a/summary' });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('BOARD_SUMMARY_UNAVAILABLE');
    expect(res.body).not.toContain('db.internal');
    expect(lines.join('\n')).toMatch(/board summary unavailable/);
    await app.close();
  });

  it('directory context: thrown query → 503 (not empty 200) with an error log', async () => {
    await expect(loadInstitutionDirectoryContext('t1', failingClient as never)).rejects.toThrow();
    const lines: string[] = [];
    const app = Fastify({
      logger: { level: 'error', stream: { write: (l: string) => lines.push(l) } },
    });
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = '550e8400-e29b-41d4-a716-446655440000';
    });
    registerInstitutionDirectoryRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/institutions/directory-context' });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('DIRECTORY_CONTEXT_UNAVAILABLE');
    expect(lines.join('\n')).toMatch(/directory context unavailable/);
    await app.close();
  });
});
