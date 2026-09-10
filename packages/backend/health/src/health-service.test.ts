/**
 * Health Service Unit Tests
 *
 * Tests for:
 * - Health data CRUD (measurements, allergies, conditions, vaccinations, insurance)
 * - Special needs (assessments, diagnoses, referrals, accommodation plans)
 * - Counselling session management
 * - Access control (Requirement 12.4)
 * - Screening programs (Requirement 12.5)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError, ForbiddenError, ForbiddenError, NotFoundError } from '@proctira/common';

import { HealthService, hasHealthAccess } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

describe('HealthService', () => {
  let service: HealthService;
  let repository: InMemoryHealthRepository;
  const tenantId = 'tenant-001';

  const healthOfficerContext: HealthAccessContext = {
    userId: 'user-health-officer',
    roles: ['health_officer'],
    guardianOfStudentIds: [],
  };

  const guardianContext: HealthAccessContext = {
    userId: 'user-guardian',
    roles: ['guardian'],
    guardianOfStudentIds: ['student-001'],
  };

  const unauthorizedContext: HealthAccessContext = {
    userId: 'user-teacher',
    roles: ['teacher'],
    guardianOfStudentIds: [],
  };

  beforeEach(() => {
    repository = new InMemoryHealthRepository();
    service = new HealthService(repository);
  });

  describe('hasHealthAccess', () => {
    it('grants access to health_officer role', () => {
      expect(hasHealthAccess(healthOfficerContext, 'student-001')).toBe(true);
    });

    it('grants access to guardian of the student', () => {
      expect(hasHealthAccess(guardianContext, 'student-001')).toBe(true);
    });

    it('denies access to guardian for a different student', () => {
      expect(hasHealthAccess(guardianContext, 'student-999')).toBe(false);
    });

    it('denies access to unauthorized roles', () => {
      expect(hasHealthAccess(unauthorizedContext, 'student-001')).toBe(false);
    });

    it('grants access to counsellor role', () => {
      const ctx: HealthAccessContext = {
        userId: 'u1',
        roles: ['counsellor'],
        guardianOfStudentIds: [],
      };
      expect(hasHealthAccess(ctx, 'student-001')).toBe(true);
    });

    it('grants access to system_admin role', () => {
      const ctx: HealthAccessContext = {
        userId: 'u1',
        roles: ['system_admin'],
        guardianOfStudentIds: [],
      };
      expect(hasHealthAccess(ctx, 'student-001')).toBe(true);
    });
  });

  describe('Measurements', () => {
    it('creates a measurement for authorized user', async () => {
      const result = await service.createMeasurement(
        tenantId,
        {
          studentId: 'student-001',
          date: '2024-03-15',
          height: 165,
          weight: 55,
        },
        healthOfficerContext,
      );

      expect(result.id).toBeDefined();
      expect(result.studentId).toBe('student-001');
      expect(result.height).toBe(165);
      expect(result.weight).toBe(55);
    });

    it('denies measurement creation for unauthorized user', async () => {
      await expect(
        service.createMeasurement(
          tenantId,
          {
            studentId: 'student-001',
            date: '2024-03-15',
            height: 165,
          },
          unauthorizedContext,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows guardian to create measurement for their student', async () => {
      const result = await service.createMeasurement(
        tenantId,
        {
          studentId: 'student-001',
          date: '2024-03-15',
          height: 165,
        },
        guardianContext,
      );

      expect(result.studentId).toBe('student-001');
    });

    it('lists measurements by student', async () => {
      await service.createMeasurement(
        tenantId,
        { studentId: 'student-001', date: '2024-01-01', height: 160 },
        healthOfficerContext,
      );
      await service.createMeasurement(
        tenantId,
        { studentId: 'student-001', date: '2024-06-01', height: 165 },
        healthOfficerContext,
      );

      const result = await service.listMeasurements(
        tenantId,
        'student-001',
        { page: 1, pageSize: 10 },
        healthOfficerContext,
      );
      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
    });

    it('updates a measurement', async () => {
      const created = await service.createMeasurement(
        tenantId,
        { studentId: 'student-001', date: '2024-03-15', height: 165 },
        healthOfficerContext,
      );
      const updated = await service.updateMeasurement(
        tenantId,
        created.id,
        { height: 167 },
        healthOfficerContext,
      );
      expect(updated.height).toBe(167);
    });

    it('deletes a measurement', async () => {
      const created = await service.createMeasurement(
        tenantId,
        { studentId: 'student-001', date: '2024-03-15', height: 165 },
        healthOfficerContext,
      );
      await service.deleteMeasurement(tenantId, created.id, healthOfficerContext);
      await expect(
        service.getMeasurement(tenantId, created.id, healthOfficerContext),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Allergies', () => {
    it('creates an allergy record', async () => {
      const result = await service.createAllergy(
        tenantId,
        {
          studentId: 'student-001',
          allergyType: 'food',
          description: 'Peanut allergy',
          severity: 'severe',
          reaction: 'Anaphylaxis',
          treatment: 'EpiPen',
        },
        healthOfficerContext,
      );

      expect(result.allergyType).toBe('food');
      expect(result.severity).toBe('severe');
    });

    it('denies allergy creation for unauthorized user', async () => {
      await expect(
        service.createAllergy(
          tenantId,
          {
            studentId: 'student-001',
            allergyType: 'food',
            description: 'Peanut allergy',
            severity: 'severe',
          },
          unauthorizedContext,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('updates an allergy record', async () => {
      const created = await service.createAllergy(
        tenantId,
        {
          studentId: 'student-001',
          allergyType: 'food',
          description: 'Peanut allergy',
          severity: 'moderate',
        },
        healthOfficerContext,
      );

      const updated = await service.updateAllergy(
        tenantId,
        created.id,
        { severity: 'severe' },
        healthOfficerContext,
      );
      expect(updated.severity).toBe('severe');
    });
  });

  describe('Conditions', () => {
    it('creates a health condition', async () => {
      const result = await service.createCondition(
        tenantId,
        {
          studentId: 'student-001',
          conditionName: 'Asthma',
          conditionType: 'respiratory',
          status: 'managed',
          medication: 'Inhaler',
        },
        healthOfficerContext,
      );

      expect(result.conditionName).toBe('Asthma');
      expect(result.status).toBe('managed');
    });

    it('updates a condition status', async () => {
      const created = await service.createCondition(
        tenantId,
        {
          studentId: 'student-001',
          conditionName: 'Asthma',
          conditionType: 'respiratory',
          status: 'active',
        },
        healthOfficerContext,
      );

      const updated = await service.updateCondition(
        tenantId,
        created.id,
        { status: 'resolved' },
        healthOfficerContext,
      );
      expect(updated.status).toBe('resolved');
    });
  });

  describe('Vaccinations', () => {
    it('creates a vaccination record', async () => {
      const result = await service.createVaccination(
        tenantId,
        {
          studentId: 'student-001',
          vaccineName: 'MMR',
          doseNumber: 1,
          dateAdministered: '2024-01-15',
          administeredBy: 'Dr. Smith',
          batchNumber: 'BATCH-001',
          nextDueDate: '2025-01-15',
        },
        healthOfficerContext,
      );

      expect(result.vaccineName).toBe('MMR');
      expect(result.doseNumber).toBe(1);
      expect(result.nextDueDate).toBe('2025-01-15');
    });

    it('lists vaccinations by student', async () => {
      await service.createVaccination(
        tenantId,
        {
          studentId: 'student-001',
          vaccineName: 'MMR',
          doseNumber: 1,
          dateAdministered: '2024-01-15',
        },
        healthOfficerContext,
      );
      await service.createVaccination(
        tenantId,
        {
          studentId: 'student-001',
          vaccineName: 'Polio',
          doseNumber: 1,
          dateAdministered: '2024-02-15',
        },
        healthOfficerContext,
      );

      const result = await service.listVaccinations(
        tenantId,
        'student-001',
        { page: 1, pageSize: 10 },
        healthOfficerContext,
      );
      expect(result.data).toHaveLength(2);
    });
  });

  describe('Insurance', () => {
    it('creates an insurance record', async () => {
      const result = await service.createInsurance(
        tenantId,
        {
          studentId: 'student-001',
          provider: 'HealthCare Inc.',
          policyNumber: 'POL-12345',
          coverageType: 'comprehensive',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
        },
        healthOfficerContext,
      );

      expect(result.provider).toBe('HealthCare Inc.');
      expect(result.policyNumber).toBe('POL-12345');
    });

    it('updates insurance details', async () => {
      const created = await service.createInsurance(
        tenantId,
        {
          studentId: 'student-001',
          provider: 'HealthCare Inc.',
          policyNumber: 'POL-12345',
          coverageType: 'basic',
          startDate: '2024-01-01',
        },
        healthOfficerContext,
      );

      const updated = await service.updateInsurance(
        tenantId,
        created.id,
        { coverageType: 'comprehensive' },
        healthOfficerContext,
      );
      expect(updated.coverageType).toBe('comprehensive');
    });
  });

  describe('Special Needs - Assessments', () => {
    it('creates a special needs assessment', async () => {
      const result = await service.createAssessment(
        tenantId,
        {
          studentId: 'student-001',
          assessmentDate: '2024-03-01',
          assessorName: 'Dr. Johnson',
          assessorRole: 'Educational Psychologist',
          assessmentType: 'cognitive',
          findings: 'Student shows signs of dyslexia',
          recommendations: 'Recommend further evaluation and reading support',
        },
        healthOfficerContext,
      );

      expect(result.assessmentType).toBe('cognitive');
      expect(result.findings).toContain('dyslexia');
    });
  });

  describe('Special Needs - Diagnoses', () => {
    it('creates a diagnosis', async () => {
      const result = await service.createDiagnosis(
        tenantId,
        {
          studentId: 'student-001',
          diagnosisDate: '2024-04-01',
          diagnosedBy: 'Dr. Johnson',
          condition: 'Dyslexia',
          category: 'learning',
          severity: 'moderate',
          notes: 'Confirmed after comprehensive assessment',
        },
        healthOfficerContext,
      );

      expect(result.condition).toBe('Dyslexia');
      expect(result.category).toBe('learning');
    });
  });

  describe('Special Needs - Referrals', () => {
    it('creates a referral', async () => {
      const result = await service.createReferral(
        tenantId,
        {
          studentId: 'student-001',
          referralDate: '2024-04-15',
          referredBy: 'School Nurse',
          referredTo: 'Speech Therapist',
          reason: 'Speech development concerns',
          status: 'pending',
        },
        healthOfficerContext,
      );

      expect(result.referredTo).toBe('Speech Therapist');
      expect(result.status).toBe('pending');
    });

    it('updates referral status', async () => {
      const created = await service.createReferral(
        tenantId,
        {
          studentId: 'student-001',
          referralDate: '2024-04-15',
          referredBy: 'School Nurse',
          referredTo: 'Speech Therapist',
          reason: 'Speech concerns',
          status: 'pending',
        },
        healthOfficerContext,
      );

      const updated = await service.updateReferral(
        tenantId,
        created.id,
        {
          status: 'completed',
          outcome: 'Therapy sessions recommended',
        },
        healthOfficerContext,
      );

      expect(updated.status).toBe('completed');
      expect(updated.outcome).toBe('Therapy sessions recommended');
    });
  });

  describe('Special Needs - Accommodation Plans', () => {
    it('creates an accommodation plan', async () => {
      const result = await service.createAccommodationPlan(
        tenantId,
        {
          studentId: 'student-001',
          planName: 'Reading Support Plan',
          startDate: '2024-05-01',
          endDate: '2025-05-01',
          accommodations: [
            { type: 'extra_time', description: 'Extra 25% time on written exams' },
            { type: 'assistive_tech', description: 'Text-to-speech software access' },
          ],
          reviewDate: '2024-11-01',
          status: 'active',
        },
        healthOfficerContext,
      );

      expect(result.planName).toBe('Reading Support Plan');
      expect(result.accommodations).toHaveLength(2);
      expect(result.status).toBe('active');
    });

    it('updates accommodation plan status', async () => {
      const created = await service.createAccommodationPlan(
        tenantId,
        {
          studentId: 'student-001',
          planName: 'Support Plan',
          startDate: '2024-05-01',
          accommodations: [{ type: 'seating', description: 'Front row seating' }],
          status: 'active',
        },
        healthOfficerContext,
      );

      const updated = await service.updateAccommodationPlan(
        tenantId,
        created.id,
        {
          status: 'under-review',
        },
        healthOfficerContext,
      );

      expect(updated.status).toBe('under-review');
    });
  });

  describe('Counselling Sessions', () => {
    it('creates a counselling session', async () => {
      const result = await service.createCounsellingSession(
        tenantId,
        {
          studentId: 'student-001',
          counsellorId: 'staff-counsellor-001',
          sessionDate: '2024-03-20',
          sessionType: 'individual',
          reason: 'Anxiety about exams',
          caseNotes:
            'Student expressed concerns about upcoming exams. Discussed coping strategies.',
          outcome: 'Student feeling more confident',
          followUpRequired: true,
          followUpDate: '2024-04-03',
          status: 'completed',
        },
        healthOfficerContext,
      );

      expect(result.sessionType).toBe('individual');
      expect(result.followUpRequired).toBe(true);
      expect(result.followUpDate).toBe('2024-04-03');
    });

    it('rejects session when follow-up required but no date', async () => {
      await expect(
        service.createCounsellingSession(
          tenantId,
          {
            studentId: 'student-001',
            counsellorId: 'staff-001',
            sessionDate: '2024-03-20',
            sessionType: 'individual',
            reason: 'Test',
            caseNotes: 'Notes',
            followUpRequired: true,
            status: 'completed',
          },
          healthOfficerContext,
        ),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('updates a counselling session', async () => {
      const created = await service.createCounsellingSession(
        tenantId,
        {
          studentId: 'student-001',
          counsellorId: 'staff-001',
          sessionDate: '2024-03-20',
          sessionType: 'individual',
          reason: 'Anxiety',
          caseNotes: 'Initial session',
          followUpRequired: false,
          status: 'scheduled',
        },
        healthOfficerContext,
      );

      const updated = await service.updateCounsellingSession(
        tenantId,
        created.id,
        {
          status: 'completed',
          outcome: 'Positive progress',
        },
        healthOfficerContext,
      );

      expect(updated.status).toBe('completed');
      expect(updated.outcome).toBe('Positive progress');
    });

    it('lists counselling sessions by student', async () => {
      await service.createCounsellingSession(
        tenantId,
        {
          studentId: 'student-001',
          counsellorId: 'staff-001',
          sessionDate: '2024-03-20',
          sessionType: 'individual',
          reason: 'Session 1',
          caseNotes: 'Notes 1',
          followUpRequired: false,
          status: 'completed',
        },
        healthOfficerContext,
      );
      await service.createCounsellingSession(
        tenantId,
        {
          studentId: 'student-001',
          counsellorId: 'staff-001',
          sessionDate: '2024-04-03',
          sessionType: 'individual',
          reason: 'Session 2',
          caseNotes: 'Notes 2',
          followUpRequired: false,
          status: 'completed',
        },
        healthOfficerContext,
      );

      const result = await service.listCounsellingSessions(
        tenantId,
        'student-001',
        { page: 1, pageSize: 10 },
        healthOfficerContext,
      );
      expect(result.data).toHaveLength(2);
    });
  });

  describe('Screening Programs', () => {
    it('creates a screening program', async () => {
      const result = await service.createScreeningProgram(tenantId, {
        name: 'Grade 1 Vision Screening',
        description: 'Annual vision screening for Grade 1 students',
        gradeLevel: 'Grade 1',
        academicPeriodId: 'period-2024',
        assessmentTypes: ['vision', 'hearing'],
        scheduledDate: '2024-09-15',
        status: 'planned',
      });

      expect(result.name).toBe('Grade 1 Vision Screening');
      expect(result.gradeLevel).toBe('Grade 1');
      expect(result.assessmentTypes).toEqual(['vision', 'hearing']);
    });

    it('lists screening programs by grade level', async () => {
      await service.createScreeningProgram(tenantId, {
        name: 'Grade 1 Vision',
        gradeLevel: 'Grade 1',
        academicPeriodId: 'period-2024',
        assessmentTypes: ['vision'],
        status: 'planned',
      });
      await service.createScreeningProgram(tenantId, {
        name: 'Grade 2 Dental',
        gradeLevel: 'Grade 2',
        academicPeriodId: 'period-2024',
        assessmentTypes: ['dental'],
        status: 'planned',
      });

      const grade1 = await service.listScreeningProgramsByGrade(tenantId, 'Grade 1', {
        page: 1,
        pageSize: 10,
      });
      expect(grade1.data).toHaveLength(1);
      expect(grade1.data[0]!.name).toBe('Grade 1 Vision');

      const all = await service.listScreeningPrograms(tenantId, { page: 1, pageSize: 10 });
      expect(all.data).toHaveLength(2);
    });

    it('updates a screening program', async () => {
      const created = await service.createScreeningProgram(tenantId, {
        name: 'Vision Screening',
        gradeLevel: 'Grade 1',
        academicPeriodId: 'period-2024',
        assessmentTypes: ['vision'],
        status: 'planned',
      });

      const updated = await service.updateScreeningProgram(tenantId, created.id, {
        status: 'in-progress',
      });

      expect(updated.status).toBe('in-progress');
    });

    it('throws NotFoundError for non-existent program', async () => {
      await expect(service.getScreeningProgram(tenantId, 'non-existent-id')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('Wave 10 Option B — PHI access + nurse incidents', () => {
    const healthAdminContext: HealthAccessContext = {
      userId: 'user-health-admin',
      roles: ['health_admin'],
      guardianOfStudentIds: [],
    };

    it('lists all vaccinations for health roles', async () => {
      await service.createVaccination(
        tenantId,
        {
          studentId: 'student-001',
          vaccineName: 'Tdap',
          doseNumber: 1,
          dateAdministered: '2024-06-01',
        },
        healthOfficerContext,
      );
      const rows = await service.listAllVaccinations(tenantId, healthOfficerContext);
      expect(rows.some((r) => r.vaccineName === 'Tdap')).toBe(true);
    });

    it('denies PHI access log to nurse-only role', async () => {
      const nurseOnly: HealthAccessContext = {
        userId: 'user-nurse',
        roles: ['school_nurse'],
        guardianOfStudentIds: [],
      };
      await expect(service.listPhiAccessLogs(tenantId, nurseOnly)).rejects.toThrow(ForbiddenError);
    });

    it('allows PHI access log for health_admin', async () => {
      const rows = await service.listPhiAccessLogs(tenantId, healthAdminContext);
      expect(Array.isArray(rows)).toBe(true);
    });

    it('creates and lists nurse incidents', async () => {
      const created = await service.createNurseIncident(
        tenantId,
        {
          studentId: 'student-001',
          incidentAt: '2024-09-01T10:00:00.000Z',
          category: 'clinic_visit',
          severity: 'low',
          notes: 'Headache',
          reportedBy: 'Nurse Ada',
        },
        healthOfficerContext,
      );
      expect(created.category).toBe('clinic_visit');
      const listed = await service.listNurseIncidents(tenantId, healthOfficerContext);
      expect(listed.some((r) => r.id === created.id)).toBe(true);
    });
  });
});
