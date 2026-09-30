/**
 * Regression tests for post-migration validation (PRC-H106): a missing table,
 * a missing tenant_id column or any failing check must fail validation instead
 * of being silently skipped.
 */
import { describe, it, expect, vi } from 'vitest';
import { runValidationChecks, describeCheckError } from './validate-migration.js';

class PgError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

type Fault = (sql: string) => Error | null;

function fakeClient(fault: Fault = () => null) {
  return {
    query: vi.fn(async (sql: string) => {
      const err = fault(sql);
      if (err) throw err;
      return {
        rows: [
          {
            count: '5',
            orphan_count: '0',
            sample_ids: null,
            invalid_count: '0',
            missing_count: '0',
          },
        ],
      };
    }),
  };
}

describe('validateMigration checks (PRC-H106)', () => {
  it('succeeds only when every check ran cleanly', async () => {
    const result = await runValidationChecks(fakeClient() as never, 'migration_staging', 'public');
    expect(result.status).toBe('success');
    expect(result.errors).toEqual([]);
  });

  it('fails when the target students table was dropped', async () => {
    const client = fakeClient((sql) =>
      sql.includes('"public"."students"')
        ? new PgError('relation "public.students" does not exist', '42P01')
        : null,
    );
    const result = await runValidationChecks(client as never, 'migration_staging', 'public');
    expect(result.status).toBe('error');
    const studentErrors = result.errors.filter((e) => e.table === 'students');
    expect(studentErrors.length).toBeGreaterThan(0);
    expect(studentErrors[0]!.message).toMatch(/table does not exist/);
  });

  it('fails when a target table has no tenant_id column', async () => {
    const client = fakeClient((sql) =>
      sql.includes('WHERE tenant_id IS NULL') && sql.includes('"public"."students"')
        ? new PgError('column "tenant_id" does not exist', '42703')
        : null,
    );
    const result = await runValidationChecks(client as never, 'migration_staging', 'public');
    expect(result.status).toBe('error');
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        table: 'students',
        column: 'tenant_id',
        message: expect.stringMatching(/column does not exist/),
      }),
    );
  });

  it('describes generic SQL errors without hiding them', () => {
    expect(describeCheckError('UUID format check', new Error('boom'))).toBe(
      'UUID format check could not run: boom',
    );
  });
});
