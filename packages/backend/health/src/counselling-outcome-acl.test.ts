/**
 * PRC-M273: the counselling session `outcome` field is treatment PHI, just
 * like `reason` — but redactCounsellingReasons previously only blanked
 * `reason`, leaving `outcome` readable by any authorized health role (nurse,
 * health officer, admin), not just the counsellor or the student's guardian.
 *
 * Failing-first: before extending redactCounsellingReasons to also blank
 * `outcome`, a school_nurse/health_officer reading via listCounsellingSessions
 * or updateCounsellingSession's return value would see the raw outcome text
 * — the assertions below (`outcome: ''`) would have failed against that
 * pre-fix behavior (the raw string would have been returned instead).
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { HealthService } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

describe('PRC-M273 counselling outcome field ACL', () => {
  let service: HealthService;
  let repository: InMemoryHealthRepository;
  const tenantId = 'tenant-001';
  const studentId = 'student-001';
  const institutionId = 'inst-1';

  const healthOfficer: HealthAccessContext = {
    userId: 'user-health-officer',
    roles: ['health_admin'],
    guardianOfStudentIds: [],
  };

  const schoolNurse: HealthAccessContext = {
    userId: 'user-nurse',
    roles: ['school_nurse'],
    guardianOfStudentIds: [],
    authoritativeInstitutionIds: [institutionId],
  };

  const counsellor: HealthAccessContext = {
    userId: 'user-counsellor',
    roles: ['counsellor'],
    guardianOfStudentIds: [],
    authoritativeInstitutionIds: [institutionId],
  };

  const guardian: HealthAccessContext = {
    userId: 'user-guardian',
    roles: [],
    guardianOfStudentIds: [studentId],
  };

  beforeEach(() => {
    repository = new InMemoryHealthRepository();
    repository.setStudentInstitution(tenantId, studentId, institutionId);
    service = new HealthService(repository);
  });

  it('school_nurse (not guardian, not counsellor) sees blanked outcome via listCounsellingSessions', async () => {
    await service.createCounsellingSession(
      tenantId,
      {
        studentId,
        counsellorId: 'staff-001',
        sessionDate: '2024-03-20',
        sessionType: 'individual',
        reason: 'Anxiety',
        caseNotes: 'Notes',
        outcome: 'Referred to external therapist',
        followUpRequired: false,
        status: 'completed',
      },
      schoolNurse,
    );

    const listed = await service.listCounsellingSessions(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      schoolNurse,
    );
    expect(listed.data[0]!.outcome).toBe('');
  });

  it('health_officer sees blanked outcome via listCounsellingSessions', async () => {
    await service.createCounsellingSession(
      tenantId,
      {
        studentId,
        counsellorId: 'staff-001',
        sessionDate: '2024-03-20',
        sessionType: 'individual',
        reason: 'Anxiety',
        caseNotes: 'Notes',
        outcome: 'Referred to external therapist',
        followUpRequired: false,
        status: 'completed',
      },
      healthOfficer,
    );

    const listed = await service.listCounsellingSessions(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      healthOfficer,
    );
    expect(listed.data[0]!.outcome).toBe('');
  });

  it('counsellor (positive control) sees the real outcome via listCounsellingSessions', async () => {
    await service.createCounsellingSession(
      tenantId,
      {
        studentId,
        counsellorId: 'staff-001',
        sessionDate: '2024-03-20',
        sessionType: 'individual',
        reason: 'Anxiety',
        caseNotes: 'Notes',
        outcome: 'Referred to external therapist',
        followUpRequired: false,
        status: 'completed',
      },
      counsellor,
    );

    const listed = await service.listCounsellingSessions(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      counsellor,
    );
    expect(listed.data[0]!.outcome).toBe('Referred to external therapist');
  });

  it("the student's guardian (positive control) sees the real outcome via listCounsellingSessions", async () => {
    await service.createCounsellingSession(
      tenantId,
      {
        studentId,
        counsellorId: 'staff-001',
        sessionDate: '2024-03-20',
        sessionType: 'individual',
        reason: 'Anxiety',
        caseNotes: 'Notes',
        outcome: 'Referred to external therapist',
        followUpRequired: false,
        status: 'completed',
      },
      counsellor,
    );

    const listed = await service.listCounsellingSessions(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      guardian,
    );
    expect(listed.data[0]!.outcome).toBe('Referred to external therapist');
  });

  it('updateCounsellingSession returns a blanked outcome for a non-counsellor, non-guardian viewer', async () => {
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
      schoolNurse,
    );

    const updated = await service.updateCounsellingSession(
      tenantId,
      created.id,
      { status: 'completed', outcome: 'Positive progress' },
      schoolNurse,
    );
    // The write itself must still succeed with the real value persisted...
    expect(updated.status).toBe('completed');
    // ...but the returned entity is ACL-filtered for the caller's own role.
    expect(updated.outcome).toBe('');

    const stored = await repository.findCounsellingSessionById(created.id, tenantId);
    expect(stored?.outcome).toBe('Positive progress');
  });

  it('updateCounsellingSession returns the real outcome for the counsellor', async () => {
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
      counsellor,
    );

    const updated = await service.updateCounsellingSession(
      tenantId,
      created.id,
      { status: 'completed', outcome: 'Positive progress' },
      counsellor,
    );
    expect(updated.outcome).toBe('Positive progress');
  });
});
