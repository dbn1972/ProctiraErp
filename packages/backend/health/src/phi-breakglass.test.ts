/**
 * P0-09: Field ACL for counselling.case_notes + dual-control break-glass.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError, ConflictError, ForbiddenError } from '@proctira/common';

import { HealthService } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import { PHI_FIELD_COUNSELLING_CASE_NOTES, PHI_FIELD_REDACTED } from './phi-field-acl.js';

describe('Health PHI field ACL + break-glass (P0-09)', () => {
  let service: HealthService;
  let repository: InMemoryHealthRepository;
  const tenantId = 'tenant-001';
  const studentId = 'student-001';
  const sensitiveNotes = 'Confidential crisis notes — do not share';

  const requester: HealthAccessContext = {
    userId: 'user-counsellor',
    roles: ['counsellor'],
    guardianOfStudentIds: [],
    institutionIds: ['inst-1'],
    purpose: 'treatment',
  };

  const approver: HealthAccessContext = {
    userId: 'user-health-admin',
    roles: ['health_admin'],
    guardianOfStudentIds: [],
  };

  beforeEach(async () => {
    repository = new InMemoryHealthRepository();
    repository.setStudentInstitution(tenantId, studentId, 'inst-1');
    service = new HealthService(repository);
    await service.createCounsellingSession(
      tenantId,
      {
        studentId,
        counsellorId: 'staff-counsellor-001',
        sessionDate: '2024-03-20',
        sessionType: 'individual',
        reason: 'Crisis follow-up',
        caseNotes: sensitiveNotes,
        followUpRequired: false,
        status: 'completed',
      },
      requester,
    );
  });

  it('redacts caseNotes when the role has coarse health access but no break-glass grant', async () => {
    const listed = await service.listCounsellingSessions(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      requester,
    );
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]!.caseNotes).toBe(PHI_FIELD_REDACTED);
    expect(listed.data[0]!.caseNotes).not.toContain('Confidential');

    const logs = await repository.listPhiAccessLogs(tenantId, { studentId });
    const unredactLogs = logs.filter((l) => l.resourceType === 'counselling_session.case_notes');
    expect(unredactLogs).toHaveLength(0);
  });

  it('rejects self-approval (dual-control)', async () => {
    const grant = await service.requestBreakGlass(
      tenantId,
      {
        studentId,
        fieldPath: PHI_FIELD_COUNSELLING_CASE_NOTES,
        justification: 'Need plaintext case notes for safeguarding review board',
        durationMinutes: 30,
      },
      requester,
    );
    expect(grant.status).toBe('pending');

    const selfApprover: HealthAccessContext = {
      ...requester,
      roles: ['health_admin', 'counsellor'],
    };
    await expect(service.approveBreakGlass(tenantId, grant.id, selfApprover)).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('allows plaintext caseNotes after dual-control approve and audits breakGlassId', async () => {
    const grant = await service.requestBreakGlass(
      tenantId,
      {
        studentId,
        fieldPath: PHI_FIELD_COUNSELLING_CASE_NOTES,
        justification: 'Need plaintext case notes for safeguarding review board',
        durationMinutes: 60,
      },
      requester,
    );

    const approved = await service.approveBreakGlass(tenantId, grant.id, approver);
    expect(approved.status).toBe('approved');
    expect(approved.approverUserId).toBe(approver.userId);
    expect(approved.requesterUserId).not.toBe(approved.approverUserId);
    expect(approved.expiresAt).toBeTruthy();

    const listed = await service.listCounsellingSessions(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      requester,
    );
    expect(listed.data[0]!.caseNotes).toBe(sensitiveNotes);

    const logs = await repository.listPhiAccessLogs(tenantId, { studentId });
    const unredactLogs = logs.filter((l) => l.resourceType === 'counselling_session.case_notes');
    expect(unredactLogs.length).toBeGreaterThanOrEqual(1);
    expect(unredactLogs[0]!.breakGlassId).toBe(grant.id);
    expect(unredactLogs[0]!.actorUserId).toBe(requester.userId);
  });

  it('re-redacts after grant TTL expires', async () => {
    const grant = await service.requestBreakGlass(
      tenantId,
      {
        studentId,
        fieldPath: PHI_FIELD_COUNSELLING_CASE_NOTES,
        justification: 'Short TTL grant for incident triage review window',
        durationMinutes: 1,
      },
      requester,
    );
    await service.approveBreakGlass(tenantId, grant.id, approver);

    const stored = await repository.findBreakGlassGrantById(grant.id, tenantId);
    expect(stored?.status).toBe('approved');

    const afterTtl = new Date(Date.now() + 2 * 60_000);
    const activeLater = await repository.findActiveBreakGlassGrant(
      tenantId,
      requester.userId,
      studentId,
      PHI_FIELD_COUNSELLING_CASE_NOTES,
      afterTtl,
    );
    expect(activeLater).toBeNull();

    const grants = (repository as unknown as { breakGlassGrants: Map<string, typeof stored> })
      .breakGlassGrants;
    grants.set(grant.id, {
      ...stored!,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });

    const listed = await service.listCounsellingSessions(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      requester,
    );
    expect(listed.data[0]!.caseNotes).toBe(PHI_FIELD_REDACTED);
  });

  // PRC-L113: terminal grants are a conflict, not a silent 200; revoke ends access now.
  it('rejects approving a denied grant and re-approving an approved grant with 409', async () => {
    const input = {
      studentId,
      fieldPath: PHI_FIELD_COUNSELLING_CASE_NOTES,
      justification: 'Need plaintext case notes for safeguarding review board',
    };
    const denied = await service.requestBreakGlass(tenantId, input, requester);
    await service.denyBreakGlass(tenantId, denied.id, approver);
    await expect(service.approveBreakGlass(tenantId, denied.id, approver)).rejects.toThrow(
      ConflictError,
    );
    await expect(service.denyBreakGlass(tenantId, denied.id, approver)).rejects.toThrow(
      ConflictError,
    );
    const approved = await service.requestBreakGlass(tenantId, input, requester);
    await service.approveBreakGlass(tenantId, approved.id, approver);
    await expect(service.approveBreakGlass(tenantId, approved.id, approver)).rejects.toThrow(
      ConflictError,
    );
  });

  it('revoke immediately stops unredaction and is admin-only', async () => {
    const grant = await service.requestBreakGlass(
      tenantId,
      {
        studentId,
        fieldPath: PHI_FIELD_COUNSELLING_CASE_NOTES,
        justification: 'Need plaintext case notes for safeguarding review board',
        durationMinutes: 60,
      },
      requester,
    );
    await service.approveBreakGlass(tenantId, grant.id, approver);
    const before = await service.listCounsellingSessions(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      requester,
    );
    expect(before.data[0]!.caseNotes).toBe(sensitiveNotes);
    await expect(service.revokeBreakGlass(tenantId, grant.id, requester)).rejects.toThrow(
      ForbiddenError,
    );
    const revoked = await service.revokeBreakGlass(tenantId, grant.id, approver);
    expect(revoked.status).toBe('revoked');
    const after = await service.listCounsellingSessions(
      tenantId,
      studentId,
      { page: 1, pageSize: 10 },
      requester,
    );
    expect(after.data[0]!.caseNotes).toBe(PHI_FIELD_REDACTED);
    await expect(service.revokeBreakGlass(tenantId, grant.id, approver)).rejects.toThrow(
      ConflictError,
    );
  });

  it('findActive does not rewrite expired grants on read', async () => {
    const grant = await service.requestBreakGlass(
      tenantId,
      {
        studentId,
        fieldPath: PHI_FIELD_COUNSELLING_CASE_NOTES,
        justification: 'Short TTL grant for incident triage review window',
        durationMinutes: 1,
      },
      requester,
    );
    await service.approveBreakGlass(tenantId, grant.id, approver);
    const later = new Date(Date.now() + 2 * 60_000);
    await expect(
      repository.findActiveBreakGlassGrant(
        tenantId,
        requester.userId,
        studentId,
        PHI_FIELD_COUNSELLING_CASE_NOTES,
        later,
      ),
    ).resolves.toBeNull();
    const stored = await repository.findBreakGlassGrantById(grant.id, tenantId);
    expect(stored?.status).toBe('approved');
  });

  it('denies break-glass approve for non-admin health roles', async () => {
    const grant = await service.requestBreakGlass(
      tenantId,
      {
        studentId,
        fieldPath: PHI_FIELD_COUNSELLING_CASE_NOTES,
        justification: 'Need plaintext case notes for safeguarding review board',
      },
      requester,
    );
    const nurse: HealthAccessContext = {
      userId: 'user-nurse',
      roles: ['school_nurse'],
      guardianOfStudentIds: [],
    };
    await expect(service.approveBreakGlass(tenantId, grant.id, nurse)).rejects.toThrow(
      ForbiddenError,
    );
  });
});
