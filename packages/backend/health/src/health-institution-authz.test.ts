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
    expect(
      hasHealthAccess(missingScope, studentId, { studentInstitutionId: institutionA }),
    ).toBe(false);
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
    const result = await service.listAllergies(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      ctx,
    );
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
});
