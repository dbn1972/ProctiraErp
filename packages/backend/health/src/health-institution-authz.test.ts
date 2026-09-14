/**
 * W1-SEC-04 (D7) — school-bound health staff must not access PHI outside their institution.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenError } from '@proctira/common';

import { HealthService, hasHealthAccess } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

describe('W1-SEC-04 (D7) health institution authz', () => {
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
