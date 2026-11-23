/**
 * D1-F1 / D1-F3: `withPgSavepoint` keeps a `withPgTenant` transaction usable after a tolerated
 * error. The fake client copies Postgres semantics: after a failed statement every statement
 * fails with 25P02 until `ROLLBACK` or `ROLLBACK TO SAVEPOINT`.
 */
import { describe, expect, it } from 'vitest';
import { withPgSavepoint } from './pg-savepoint';
function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
function transactionalClient(failOn: string) {
  const log: string[] = [];
  let aborted = false;
  return {
    log,
    query: async (sql: string) => {
      log.push(sql);
      const head = sql.trim();
      if (head === 'ROLLBACK' || head.startsWith('ROLLBACK TO SAVEPOINT')) {
        aborted = false;
        return { rows: [] };
      }
      if (aborted) {
        throw pgError(
          '25P02',
          'current transaction is aborted, commands ignored until end of transaction block',
        );
      }
      if (sql.includes(failOn)) {
        aborted = true;
        throw pgError('42P01', `relation "${failOn}" does not exist`);
      }
      return { rows: [{ ok: sql }] };
    },
  };
}
describe('withPgSavepoint (D1-F1)', () => {
  it('returns the block result and releases the savepoint', async () => {
    const client = transactionalClient('never');
    const result = await withPgSavepoint(client, 'overview_students', async (c) => {
      const { rows } = await c.query('SELECT 1');
      return rows[0];
    });
    expect(result).toEqual({ ok: 'SELECT 1' });
    expect(client.log).toEqual([
      'SAVEPOINT overview_students',
      'SELECT 1',
      'RELEASE SAVEPOINT overview_students',
    ]);
  });
  it('rolls back to the savepoint and rethrows, so later statements still run', async () => {
    const client = transactionalClient('missing_table');
    await expect(
      withPgSavepoint(client, 'overview_rooms', (c) => c.query('SELECT * FROM missing_table')),
    ).rejects.toMatchObject({ code: '42P01' });
    // The transaction is usable again: no 25P02 for the next statement.
    await expect(client.query('SELECT 2')).resolves.toEqual({ rows: [{ ok: 'SELECT 2' }] });
    expect(client.log).toContain('ROLLBACK TO SAVEPOINT overview_rooms');
  });
  it('rejects a savepoint name that is not a plain identifier', async () => {
    const client = transactionalClient('never');
    await expect(withPgSavepoint(client, 'x; DROP TABLE students', async () => 1)).rejects.toThrow(
      /savepoint name/i,
    );
    expect(client.log).toEqual([]);
  });
});
