/**
 * PRC-M264/M267 (PR #548 review item 2): only the grade-entry and
 * transcript-version unique constraints map to a generic 409. Any other
 * Postgres 23505 (e.g. credit-rule `(tenant_id, code)`) keeps the driver error.
 */
import { ConflictError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

import { PgGradebookRepository, isConcurrentKeyViolation } from './pg-gradebook-repository.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function uniqueViolation(constraint: string): Error {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { code: '23505', constraint },
  );
}

/** Pool whose INSERT fails with the given error; tx control statements succeed. */
function failingPool(insertError: Error) {
  const client = {
    query: vi.fn(async (text: string) => {
      if (/^\s*INSERT/i.test(text)) throw insertError;
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { connect: vi.fn(async () => client), query: vi.fn() };
}

const now = new Date();

describe('PgGradebookRepository unique-violation mapping', () => {
  it('classifies only the named natural-key constraints as concurrent-key races', () => {
    expect(isConcurrentKeyViolation(uniqueViolation('grade_entries_upsert_uidx'))).toBe(true);
    expect(
      isConcurrentKeyViolation(
        uniqueViolation('transcript_issuances_tenant_id_student_id_version_key'),
      ),
    ).toBe(true);
    expect(isConcurrentKeyViolation(uniqueViolation('credit_rules_tenant_id_code_key'))).toBe(
      false,
    );
    // A 23505 without a constraint name is not assumed to be one of ours.
    expect(isConcurrentKeyViolation({ code: '23505' })).toBe(false);
    expect(
      isConcurrentKeyViolation({ code: '23503', constraint: 'grade_entries_upsert_uidx' }),
    ).toBe(false);
  });

  it('transcript version race -> ConflictError (409)', async () => {
    const repo = new PgGradebookRepository(
      failingPool(
        uniqueViolation('transcript_issuances_tenant_id_student_id_version_key'),
      ) as never,
    );
    await expect(
      repo.createTranscript({
        id: '22222222-2222-4222-8222-222222222222',
        tenantId: TENANT,
        studentId: '33333333-3333-4333-8333-333333333333',
        version: 2,
        status: 'ISSUED',
        issuedAt: now,
        issuedBy: null,
        artifactUri: null,
        checksumSha256: null,
        signatureHmac: null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      } as never),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('credit-rule duplicate keeps the driver duplicate-key error (not a generic 409)', async () => {
    const repo = new PgGradebookRepository(
      failingPool(uniqueViolation('credit_rules_tenant_id_code_key')) as never,
    );
    const err = await repo
      .createCreditRule({
        id: '44444444-4444-4444-8444-444444444444',
        tenantId: TENANT,
        boardId: null,
        code: 'MATH-101',
        name: 'Maths',
        credits: 4,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      } as never)
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ConflictError);
    expect(String((err as Error).message)).toMatch(/duplicate key|unique/i);
  });
});
