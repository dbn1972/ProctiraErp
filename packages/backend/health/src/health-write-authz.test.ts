/**
 * PRC-L314 / PRC-L311: write-access gate.
 *
 * hasHealthAccess short-circuits true for a guardian-of-student *before* the
 * role/institution checks, which is correct for reads but was also being used
 * to gate every write path (create/update/delete) and the break-glass request
 * workflow — letting a guardian with no authorized health role mutate PHI or
 * request a break-glass grant for case notes they are never meant to see
 * unredacted. hasHealthWriteAccess / assertHealthWriteAccess close that gap by
 * skipping the guardian short-circuit; only an authorized health role (with
 * institution scope for school-bound roles) may write.
 *
 * Failing-first: before this fix, every one of the "guardian denied" cases
 * below passed through assertHealthAccess's `guardianOfStudentIds.includes`
 * branch and succeeded — the current test bodies demonstrate the post-fix
 * behavior (ForbiddenError), which would NOT have held against the pre-fix
 * code path (see the "pre-fix" comment on the first case for how to verify
 * this manually: temporarily swap assertHealthWriteAccess back to
 * assertHealthAccess in health-service.ts's call sites and these tests fail).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenError } from '@proctira/common';

import { HealthService, hasHealthWriteAccess } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import { PHI_FIELD_COUNSELLING_CASE_NOTES } from './phi-field-acl.js';

describe('PRC-L314/L311 health write-access gate', () => {
  let service: HealthService;
  let repository: InMemoryHealthRepository;
  const tenantId = 'tenant-001';
  const studentId = 'student-001';
  const institutionId = 'inst-1';

  const guardianOnly: HealthAccessContext = {
    userId: 'user-guardian',
    roles: [],
    guardianOfStudentIds: [studentId],
  };

  const schoolNurseInScope: HealthAccessContext = {
    userId: 'user-nurse',
    roles: ['school_nurse'],
    guardianOfStudentIds: [],
    authoritativeInstitutionIds: [institutionId],
  };

  beforeEach(() => {
    repository = new InMemoryHealthRepository();
    repository.setStudentInstitution(tenantId, studentId, institutionId);
    service = new HealthService(repository);
  });

  describe('hasHealthWriteAccess (unit)', () => {
    it('does NOT short-circuit true for a guardian of the student (unlike hasHealthAccess)', () => {
      expect(hasHealthWriteAccess(guardianOnly, studentId)).toBe(false);
    });

    it('still grants a school-bound role with matching institution scope', () => {
      expect(
        hasHealthWriteAccess(schoolNurseInScope, studentId, {
          studentInstitutionId: institutionId,
        }),
      ).toBe(true);
    });
  });

  describe('write methods reject a guardian-only context', () => {
    it('createMeasurement rejects', async () => {
      await expect(
        service.createMeasurement(tenantId, { studentId, date: '2024-03-15' }, guardianOnly),
      ).rejects.toThrow(ForbiddenError);
    });

    it('updateAllergy rejects', async () => {
      const created = await service.createAllergy(
        tenantId,
        { studentId, allergyType: 'food', description: 'Peanuts', severity: 'high' },
        schoolNurseInScope,
      );
      await expect(
        service.updateAllergy(tenantId, created.id, { severity: 'severe' }, guardianOnly),
      ).rejects.toThrow(ForbiddenError);
    });

    it('deleteCondition rejects', async () => {
      const created = await service.createCondition(
        tenantId,
        { studentId, conditionName: 'Asthma', conditionType: 'respiratory', status: 'active' },
        schoolNurseInScope,
      );
      await expect(service.deleteCondition(tenantId, created.id, guardianOnly)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('createReferral rejects', async () => {
      await expect(
        service.createReferral(
          tenantId,
          {
            studentId,
            referralDate: '2024-04-15',
            referredBy: 'School Nurse',
            referredTo: 'Speech Therapist',
            reason: 'Speech concerns',
            status: 'pending',
          },
          guardianOnly,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('updateCounsellingSession rejects', async () => {
      const created = await service.createCounsellingSession(
        tenantId,
        {
          studentId,
          counsellorId: 'staff-001',
          sessionDate: '2024-03-20',
          sessionType: 'individual',
          reason: 'Anxiety',
          caseNotes: 'Notes',
          followUpRequired: false,
          status: 'scheduled',
        },
        schoolNurseInScope,
      );
      await expect(
        service.updateCounsellingSession(
          tenantId,
          created.id,
          { status: 'completed' },
          guardianOnly,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('requestBreakGlass rejects (PRC-L311: guardians never request break-glass)', async () => {
      await expect(
        service.requestBreakGlass(
          tenantId,
          {
            studentId,
            fieldPath: PHI_FIELD_COUNSELLING_CASE_NOTES,
            justification: 'Guardian attempting to self-grant access',
          },
          guardianOnly,
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('read methods remain unchanged for the same guardian context', () => {
    it('listAllergiesByStudent-equivalent (listAllergies) still succeeds for the guardian', async () => {
      await service.createAllergy(
        tenantId,
        { studentId, allergyType: 'food', description: 'Peanuts', severity: 'high' },
        schoolNurseInScope,
      );
      const result = await service.listAllergies(
        tenantId,
        studentId,
        { page: 1, pageSize: 10 },
        guardianOnly,
      );
      expect(result.data).toHaveLength(1);
    });

    it('getMeasurement still succeeds for the guardian', async () => {
      const created = await service.createMeasurement(
        tenantId,
        { studentId, date: '2024-03-15', height: 165 },
        schoolNurseInScope,
      );
      const read = await service.getMeasurement(tenantId, created.id, guardianOnly);
      expect(read.id).toBe(created.id);
    });
  });

  describe('a school_nurse with correct institution scope still succeeds on all write calls', () => {
    it('createMeasurement/updateAllergy/deleteCondition/createReferral/updateCounsellingSession/requestBreakGlass all succeed', async () => {
      const measurement = await service.createMeasurement(
        tenantId,
        { studentId, date: '2024-03-15', height: 165 },
        schoolNurseInScope,
      );
      expect(measurement.id).toBeDefined();

      const allergy = await service.createAllergy(
        tenantId,
        { studentId, allergyType: 'food', description: 'Peanuts', severity: 'high' },
        schoolNurseInScope,
      );
      const updatedAllergy = await service.updateAllergy(
        tenantId,
        allergy.id,
        { severity: 'severe' },
        schoolNurseInScope,
      );
      expect(updatedAllergy.severity).toBe('severe');

      const condition = await service.createCondition(
        tenantId,
        { studentId, conditionName: 'Asthma', conditionType: 'respiratory', status: 'active' },
        schoolNurseInScope,
      );
      await service.deleteCondition(tenantId, condition.id, schoolNurseInScope);

      const referral = await service.createReferral(
        tenantId,
        {
          studentId,
          referralDate: '2024-04-15',
          referredBy: 'School Nurse',
          referredTo: 'Speech Therapist',
          reason: 'Speech concerns',
          status: 'pending',
        },
        schoolNurseInScope,
      );
      expect(referral.id).toBeDefined();

      const session = await service.createCounsellingSession(
        tenantId,
        {
          studentId,
          counsellorId: 'staff-001',
          sessionDate: '2024-03-20',
          sessionType: 'individual',
          reason: 'Anxiety',
          caseNotes: 'Notes',
          followUpRequired: false,
          status: 'scheduled',
        },
        schoolNurseInScope,
      );
      const updatedSession = await service.updateCounsellingSession(
        tenantId,
        session.id,
        { status: 'completed' },
        schoolNurseInScope,
      );
      expect(updatedSession.status).toBe('completed');

      const grant = await service.requestBreakGlass(
        tenantId,
        {
          studentId,
          fieldPath: PHI_FIELD_COUNSELLING_CASE_NOTES,
          justification: 'Clinical review of case notes for safeguarding',
        },
        schoolNurseInScope,
      );
      expect(grant.status).toBe('pending');
    });
  });
});
