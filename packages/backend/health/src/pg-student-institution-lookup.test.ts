/**
 * PRC-L312: the student-institution lookup must not turn a query failure into
 * "no institution". Before the fix, pg-student-institution-lookup.ts caught
 * every error and returned `null`, so a failed lookup looked like "student not
 * enrolled" and the counselling store derived its PHI crypto scope from the
 * student id instead of the institution.
 */
import { randomUUID } from 'node:crypto';
import { ForbiddenError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { HealthService } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import type { PgPoolLike } from './pg-counselling-store.js';
import { findStudentInstitutionId } from './pg-student-institution-lookup.js';

function poolFailingOnEnrollments(): PgPoolLike {
  return {
    query: (async (text: string) => {
      if (String(text).includes('FROM enrollments')) {
        throw new Error('simulated RLS/connection failure');
      }
      return { rows: [], rowCount: 0 };
    }) as unknown as PgPoolLike['query'],
    end: async () => undefined,
  };
}

function poolReturning(rows: Array<Record<string, unknown>>): PgPoolLike {
  return {
    query: (async () => ({ rows, rowCount: rows.length })) as unknown as PgPoolLike['query'],
    end: async () => undefined,
  };
}

describe('PRC-L312: student-institution lookup fails closed', () => {
  const tenantId = randomUUID();
  const studentId = randomUUID();

  it('re-throws a query failure instead of returning null', async () => {
    await expect(
      findStudentInstitutionId(poolFailingOnEnrollments(), tenantId, studentId),
    ).rejects.toThrow('simulated RLS/connection failure');
  });

  it('returns null only when not attempted or no active enrollment', async () => {
    await expect(findStudentInstitutionId(null, tenantId, studentId)).resolves.toBeNull();
    await expect(findStudentInstitutionId(poolReturning([]), tenantId, studentId)).resolves.toBe(
      null,
    );
    await expect(
      findStudentInstitutionId(poolReturning([{ institution_id: 'inst-a' }]), tenantId, studentId),
    ).resolves.toBe('inst-a');
  });

  describe('HealthService when the student-institution lookup throws', () => {
    class ThrowingStudentLookupRepository extends InMemoryHealthRepository {
      override async findStudentInstitutionId(): Promise<string | null> {
        throw new Error('simulated RLS/connection failure');
      }
    }
    const allergy = {
      studentId,
      allergyType: 'food',
      description: 'Peanuts',
      severity: 'high',
    } as const;

    it('denies a school-bound actor with 403 rather than a raw error', async () => {
      const repo = new ThrowingStudentLookupRepository();
      const service = new HealthService(repo);
      const nurse: HealthAccessContext = {
        userId: 'nurse-a',
        roles: ['school_nurse'],
        guardianOfStudentIds: [],
        institutionIds: ['inst-a'],
        authoritativeInstitutionIds: ['inst-a'],
      };
      await expect(
        service.listAllergies(tenantId, studentId, { page: 1, pageSize: 10 }, nurse),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.createAllergy(tenantId, allergy, nurse)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('a tenant-wide health_admin is unaffected', async () => {
      const repo = new ThrowingStudentLookupRepository();
      const service = new HealthService(repo);
      const admin: HealthAccessContext = {
        userId: 'admin-1',
        roles: ['health_admin'],
        guardianOfStudentIds: [],
      };
      await service.createAllergy(tenantId, allergy, admin);
      const result = await service.listAllergies(
        tenantId,
        studentId,
        { page: 1, pageSize: 10 },
        admin,
      );
      expect(result.data).toHaveLength(1);
    });
  });
});
