/**
 * W1-SEC-04 COMPLETE — deny-on-missing institution scope + authoritative assignments.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenError } from '@proctira/common';

import {
  HealthService,
  hasHealthAccess,
  isSchoolBoundHealthActor,
  effectiveInstitutionIds,
} from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

describe('W1-SEC-04 COMPLETE health institution authz', () => {
  const tenantId = 'tenant-001';
  const studentId = 'student-inst-a';
  const institutionA = 'inst-a';
  const institutionB = 'inst-b';

  let service: HealthService;
  let repository: InMemoryHealthRepository;

  const schoolNurseInstA: HealthAccessContext = {
    userId: 'nurse-a',
    roles: ['school_nurse'],
    guardianOfStudentIds: [],
    institutionIds: [institutionA],
  };

  beforeEach(async () => {
    repository = new InMemoryHealthRepository();
    repository.setStudentInstitution(tenantId, studentId, institutionA);
    service = new HealthService(repository);
    await service.createAllergy(
      tenantId,
      {
        studentId,
        allergyType: 'food',
        description: 'Peanuts',
        severity: 'high',
      },
      {
        userId: 'health-admin',
        roles: ['health_admin'],
        guardianOfStudentIds: [],
      },
    );
  });

  it('denies school-bound staff when student institution is outside JWT institutions claim', () => {
    expect(
      hasHealthAccess(schoolNurseInstA, studentId, { studentInstitutionId: institutionB }),
    ).toBe(false);
  });

  it('allows school-bound staff for students enrolled at their institution', () => {
    expect(
      hasHealthAccess(schoolNurseInstA, studentId, { studentInstitutionId: institutionA }),
    ).toBe(true);
  });

  it('allows tenant-wide health_admin without institutionIds claim', () => {
    const tenantWide: HealthAccessContext = {
      userId: 'admin',
      roles: ['health_admin'],
      guardianOfStudentIds: [],
    };
    expect(hasHealthAccess(tenantWide, studentId, { studentInstitutionId: institutionB })).toBe(
      true,
    );
  });

  it('denies school_nurse when institution scope is missing (no tenant-wide elevation)', () => {
    const missingScope: HealthAccessContext = {
      userId: 'nurse-noscope',
      roles: ['school_nurse'],
      guardianOfStudentIds: [],
    };
    expect(isSchoolBoundHealthActor(missingScope)).toBe(true);
    expect(effectiveInstitutionIds(missingScope)).toEqual([]);
    expect(hasHealthAccess(missingScope, studentId, { studentInstitutionId: institutionA })).toBe(
      false,
    );
  });

  it('denies health_officer tenant-wide list when institution scope is missing', () => {
    const officer: HealthAccessContext = {
      userId: 'officer',
      roles: ['health_officer'],
      guardianOfStudentIds: [],
    };
    expect(hasHealthAccess(officer, '')).toBe(false);
  });

  it('authoritative assignments override JWT and deny when DB says none', async () => {
    repository.setActorInstitutions(tenantId, 'nurse-a', []);
    await expect(
      service.listAllergies(tenantId, studentId, { page: 1, pageSize: 10 }, schoolNurseInstA),
    ).rejects.toThrow(ForbiddenError);
  });

  it('authoritative assignments allow when DB matches student institution', async () => {
    repository.setActorInstitutions(tenantId, 'nurse-jwt-wrong', [institutionA]);
    const ctx: HealthAccessContext = {
      userId: 'nurse-jwt-wrong',
      roles: ['school_nurse'],
      guardianOfStudentIds: [],
      institutionIds: [institutionB], // JWT lies — authoritative wins
    };
    const result = await service.listAllergies(tenantId, studentId, { page: 1, pageSize: 10 }, ctx);
    expect(result.data).toHaveLength(1);
  });

  it('service rejects list allergy for cross-institution school-bound nurse', async () => {
    const nurseInstB: HealthAccessContext = {
      userId: 'nurse-b',
      roles: ['school_nurse'],
      guardianOfStudentIds: [],
      institutionIds: [institutionB],
    };
    await expect(
      service.listAllergies(tenantId, studentId, { page: 1, pageSize: 10 }, nurseInstB),
    ).rejects.toThrow(ForbiddenError);
  });

  /**
   * PRC-L312: findActorInstitutionAssignments throwing (RLS failure, schema
   * drift, connection error) is NOT the same as "lookup not attempted" — the
   * old code treated both cases identically by catching and returning
   * `null`, so a thrown lookup fell back to JWT institution claims. A
   * school-bound actor whose JWT claims happen to include the student's real
   * institution was then granted access on a failed lookup, exactly as if
   * the lookup had never been attempted.
   *
   * Failing-first: before the fix, pg-actor-institution-assignments.ts's
   * findActorInstitutionAssignments caught the thrown error and returned
   * `null`, so resolveAuthoritativeInstitutions treated `assigned === null`
   * as "not resolved" and left the JWT `institutionIds` claim in place —
   * `schoolNurseInstA` below would have been GRANTED access despite the
   * throwing lookup. The repository stub here makes the lookup throw
   * directly to exercise that path without touching the Postgres store.
   */
  describe('PRC-L312: institution-lookup failure fails closed', () => {
    class ThrowingLookupRepository extends InMemoryHealthRepository {
      override async findActorInstitutionAssignments(): Promise<string[] | null> {
        throw new Error('simulated RLS/connection failure');
      }
    }

    it('denies a school-bound actor whose JWT claim would otherwise grant access once the lookup throws', async () => {
      const throwingRepo = new ThrowingLookupRepository();
      throwingRepo.setStudentInstitution(tenantId, studentId, institutionA);
      const throwingService = new HealthService(throwingRepo);
      await throwingService.createAllergy(
        tenantId,
        { studentId, allergyType: 'food', description: 'Peanuts', severity: 'high' },
        { userId: 'health-admin', roles: ['health_admin'], guardianOfStudentIds: [] },
      );

      // JWT claims institutionA — which matches the student's real
      // institution and would grant access if the lookup had simply not run.
      const nurseWithMatchingJwtClaim: HealthAccessContext = {
        userId: 'nurse-a',
        roles: ['school_nurse'],
        guardianOfStudentIds: [],
        institutionIds: [institutionA],
      };

      await expect(
        throwingService.listAllergies(
          tenantId,
          studentId,
          { page: 1, pageSize: 10 },
          nurseWithMatchingJwtClaim,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('a tenant-wide health_admin is unaffected by the same thrown lookup error', async () => {
      const throwingRepo = new ThrowingLookupRepository();
      throwingRepo.setStudentInstitution(tenantId, studentId, institutionA);
      const throwingService = new HealthService(throwingRepo);
      const tenantWideAdmin: HealthAccessContext = {
        userId: 'admin-1',
        roles: ['health_admin'],
        guardianOfStudentIds: [],
      };
      await throwingService.createAllergy(
        tenantId,
        { studentId, allergyType: 'food', description: 'Peanuts', severity: 'high' },
        tenantWideAdmin,
      );

      const result = await throwingService.listAllergies(
        tenantId,
        studentId,
        { page: 1, pageSize: 10 },
        tenantWideAdmin,
      );
      expect(result.data).toHaveLength(1);
    });
  });
});
