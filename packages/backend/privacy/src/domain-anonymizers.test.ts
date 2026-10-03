/**
 * PRC-H077: per-domain anonymizers and the Postgres tenant wipe executor,
 * exercised against a recording fake pg client.
 */
import { describe, expect, it } from 'vitest';
import {
  PgDomainSubjectAnonymizer,
  PgTenantWipeExecutor,
  classifyWipeTable,
  readFinanceHealthErasureMode,
} from './domain-anonymizers.js';

type Handler = (sql: string, values?: unknown[]) => { rows: unknown[]; rowCount?: number };

function fakePool(handler: Handler) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SELECT set_config)/.test(sql.trim())) {
        return { rows: [] };
      }
      return handler(sql, values);
    },
    release() {},
  };
  return { pool: { connect: async () => client, query: client.query }, queries };
}

const input = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  subjectId: 'stu-1',
  requestType: 'anonymization' as const,
  jobId: 'job-1',
};

describe('PRC-H077 domain anonymizers', () => {
  it('defaults finance/health to retain and rejects unsupported modes', () => {
    expect(readFinanceHealthErasureMode({})).toBe('retain');
    expect(() => readFinanceHealthErasureMode({ ERASURE_FINANCE_HEALTH_MODE: 'delete' })).toThrow();
  });

  it('pseudonymises a student, deletes nothing financial, and reports file residual', async () => {
    const { pool, queries } = fakePool((sql) => {
      if (sql.includes('UPDATE students')) return { rows: [], rowCount: 1 };
      if (sql.includes('SELECT id, object_key')) return { rows: [{ id: 'd1', object_key: 'k1' }] };
      return { rows: [], rowCount: 1 };
    });
    const anonymizer = new PgDomainSubjectAnonymizer(pool as never);
    const result = await anonymizer.anonymize({ ...input, subjectType: 'student' });
    expect(result.fieldsTouched).toEqual(
      expect.arrayContaining([
        'students.first_name',
        'fees:retained_statutory(retain)',
        'health:retained_statutory(retain)',
      ]),
    );
    expect(result.residualNote).toMatch(/files: 1 stored object/);
    expect(queries.some((q) => /fee|health/i.test(q.sql) && /UPDATE|DELETE/.test(q.sql))).toBe(
      false,
    );
    // Tenant id is always a bound parameter.
    const update = queries.find((q) => q.sql.includes('UPDATE students'))!;
    expect(update.values).toContain(input.tenantId);
  });

  it('completes a student erasure with no residual when an ObjectEraser is wired', async () => {
    const deleted: string[] = [];
    const { pool } = fakePool((sql) => {
      if (sql.includes('UPDATE students')) return { rows: [], rowCount: 1 };
      if (sql.includes('SELECT id, object_key')) return { rows: [{ id: 'd1', object_key: 'k1' }] };
      return { rows: [], rowCount: 1 };
    });
    const anonymizer = new PgDomainSubjectAnonymizer(pool as never, {
      objectEraser: {
        async deleteObject(_t, key) {
          deleted.push(key);
        },
      },
    });
    const result = await anonymizer.anonymize({ ...input, subjectType: 'student' });
    expect(result.residualNote).toBeUndefined();
    expect(deleted).toEqual(['k1']);
  });

  it('reports a residual for unknown subject types and missing rows', async () => {
    const { pool } = fakePool(() => ({ rows: [], rowCount: 0 }));
    const anonymizer = new PgDomainSubjectAnonymizer(pool as never);
    expect((await anonymizer.anonymize({ ...input, subjectType: 'alien' })).residualNote).toMatch(
      /No domain anonymizer/,
    );
    expect((await anonymizer.anonymize({ ...input, subjectType: 'staff' })).residualNote).toMatch(
      /staff: subject row not found/,
    );
  });
});

describe('PRC-H077 PgTenantWipeExecutor', () => {
  it('classifies tables into checklist domains', () => {
    expect(classifyWipeTable('fee_invoices')).toBe('fees');
    expect(classifyWipeTable('health_records')).toBe('health');
    expect(classifyWipeTable('student_documents')).toBe('files_storage');
    expect(classifyWipeTable('students')).toBe('students');
  });

  it('wipes tenant tables in FK-resolving passes and retains fees/health', async () => {
    let studentsAttempts = 0;
    const { pool, queries } = fakePool((sql) => {
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            'students',
            'student_documents',
            'fee_invoices',
            'health_records',
            'privacy_legal_holds',
            'staff',
          ].map((table_name) => ({ table_name })),
        };
      }
      if (sql.startsWith('DELETE FROM "students"')) {
        studentsAttempts += 1;
        if (studentsAttempts === 1) throw new Error('fk violation');
      }
      return { rows: [], rowCount: 1 };
    });
    const results = await new PgTenantWipeExecutor(pool as never, {
      objectStoreWiper: { async wipeTenant() {} },
    }).wipe({ tenantId: input.tenantId, jobId: 'j', reason: 'offboard' });
    const deletes = queries.filter((q) => q.sql.startsWith('DELETE')).map((q) => q.sql);
    expect(deletes.some((d) => d.includes('fee_invoices') || d.includes('health_records'))).toBe(
      false,
    );
    expect(deletes.some((d) => d.includes('privacy_'))).toBe(false);
    expect(studentsAttempts).toBe(2);
    const byDomain = Object.fromEntries(results.map((r) => [r.domain, r.status]));
    expect(byDomain).toMatchObject({
      students: 'completed',
      staff: 'completed',
      files_storage: 'completed',
      fees: 'skipped',
      health: 'skipped',
      object_storage: 'completed',
    });
  });

  it('reports residual when a table cannot be deleted or objects are not wiped', async () => {
    const { pool } = fakePool((sql) => {
      if (sql.includes('information_schema.columns')) return { rows: [{ table_name: 'staff' }] };
      if (sql.startsWith('DELETE')) throw new Error('permission denied');
      return { rows: [] };
    });
    const results = await new PgTenantWipeExecutor(pool as never).wipe({
      tenantId: input.tenantId,
      jobId: 'j',
      reason: 'offboard',
    });
    const byDomain = Object.fromEntries(results.map((r) => [r.domain, r.status]));
    expect(byDomain).toMatchObject({ staff: 'residual', object_storage: 'residual' });
  });
});
