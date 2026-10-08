/**
 * NEW-g7_platform-006 — the Pg correction appliers write approved rectifications to the owning
 * domain, enforce a strict field allowlist, and fail closed when nothing is written.
 *
 * This proves the gateway-wired path works: before, no correctionApplier was injected so every
 * approved correction threw PrivacyExecutorNotConfiguredError (501).
 */
import { describe, expect, it } from 'vitest';

import { CompositeCorrectionApplier } from './correction-applier.js';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import {
  PgTableCorrectionApplier,
  createStaffCorrectionApplier,
  createStudentCorrectionApplier,
} from './pg-correction-appliers.js';
import { PrivacyService } from './privacy-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

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
  return {
    pool: { connect: async () => client, query: client.query } as never,
    queries,
  };
}

async function approvedCorrection(
  service: PrivacyService,
  subjectType: string,
  fieldPath: string,
  requestedValue: string,
) {
  const req = await service.createCorrectionRequest({
    tenantId: TENANT,
    subjectType,
    subjectId: 'subj-1',
    fieldPath,
    currentValue: 'client-claimed',
    requestedValue,
    requestedBy: 'parent-1',
  });
  await service.transitionCorrectionRequest(req.id, TENANT, 'under_review', 'officer');
  await service.transitionCorrectionRequest(req.id, TENANT, 'approved', 'officer');
  return req;
}

describe('NEW-g7_platform-006 Pg correction appliers', () => {
  it('exposes only the allowlisted field paths', () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    const student = createStudentCorrectionApplier(pool);
    expect(student.allowedFieldPaths('student')).toContain('first_name');
    expect(student.allowedFieldPaths('student')).not.toContain('ssn');
  });

  it('rejects unsafe identifiers at construction', () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    expect(
      () => new PgTableCorrectionApplier(pool, { table: 'students; drop', fieldToColumn: {} }),
    ).toThrow();
    expect(
      () =>
        new PgTableCorrectionApplier(pool, {
          table: 'students',
          fieldToColumn: { f: 'col; drop' },
        }),
    ).toThrow();
  });

  it('writes the correction and marks it applied (student)', async () => {
    let stored = 'Jon';
    const { pool, queries } = fakePool((sql, values) => {
      if (/^SELECT .* FROM "students"/.test(sql)) return { rows: [{ value: stored }] };
      if (/^UPDATE "students"/.test(sql)) {
        stored = String((values as unknown[])[2]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const service = new PrivacyService(new InMemoryPrivacyRepository(), {
      audit: { record: async () => {} },
      correctionApplier: new CompositeCorrectionApplier({
        student: createStudentCorrectionApplier(pool),
      }),
    });
    const req = await approvedCorrection(service, 'student', 'first_name', 'Jonathan');
    const applied = await service.applyCorrection(req.id, TENANT, 'officer');
    expect(applied.status).toBe('applied');
    expect(stored).toBe('Jonathan');
    expect(queries.some((q) => /^UPDATE "students"/.test(q.sql))).toBe(true);
  });

  it('fails closed when the domain write affects no rows (staff)', async () => {
    const { pool } = fakePool((sql) => {
      if (/^SELECT .* FROM "staff"/.test(sql)) return { rows: [{ value: 'Existing' }] };
      if (/^UPDATE "staff"/.test(sql)) return { rows: [], rowCount: 0 }; // nothing written
      return { rows: [], rowCount: 1 };
    });
    const service = new PrivacyService(new InMemoryPrivacyRepository(), {
      audit: { record: async () => {} },
      correctionApplier: new CompositeCorrectionApplier({
        staff: createStaffCorrectionApplier(pool),
      }),
    });
    const req = await approvedCorrection(service, 'staff', 'last_name', 'NewName');
    await expect(service.applyCorrection(req.id, TENANT, 'officer')).rejects.toThrow();
    const current = await service.getCorrectionRequest(req.id, TENANT);
    expect(current?.status).toBe('approved'); // not applied — fail closed
  });
});
