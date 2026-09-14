import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it, beforeEach } from 'vitest';

import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { RecordingPrivacyAuditPort } from './privacy-audit.js';
import { PrivacyService } from './privacy-service.js';
import { RecordingSubjectAnonymizer } from './subject-anonymizer.js';

describe('PrivacyService legal hold + erasure (W1-SEC-06)', () => {
  let service: PrivacyService;
  let audit: RecordingPrivacyAuditPort;
  let anonymizer: RecordingSubjectAnonymizer;

  beforeEach(() => {
    audit = new RecordingPrivacyAuditPort();
    anonymizer = new RecordingSubjectAnonymizer();
    service = new PrivacyService(new InMemoryPrivacyRepository(), { audit, anonymizer });
  });

  it('places and releases a tenant-scope legal hold with audit', async () => {
    const hold = await service.placeLegalHold({
      tenantId: 'tenant-a',
      scope: 'tenant',
      reason: 'Litigation hold',
      placedBy: 'counsel-1',
    });
    expect(hold.active).toBe(true);
    expect(await service.isOnLegalHold('tenant-a')).toBe(true);
    expect((await service.releaseLegalHold(hold.id, 'counsel-1')).active).toBe(false);
    expect(audit.events.some((e) => e.entityType === 'privacy_legal_hold')).toBe(true);
  });

  it('blocks destructive delete while tenant legal hold is active', async () => {
    await service.placeLegalHold({
      tenantId: 'tenant-a',
      scope: 'tenant',
      reason: 'Preservation order',
      placedBy: 'ops',
    });
    await expect(service.assertDestructiveDeleteAllowed('tenant-a')).rejects.toThrow(/legal hold/i);
  });

  it('blocks subject destructive delete when subject hold is active', async () => {
    await service.placeLegalHold({
      tenantId: 'tenant-a',
      scope: 'subject',
      subjectType: 'student',
      subjectId: 'stu-1',
      reason: 'Investigation',
      placedBy: 'dsar-officer',
    });
    await expect(service.assertDestructiveDeleteAllowed('tenant-a', 'stu-1')).rejects.toThrow(
      BusinessRuleError,
    );
    await expect(service.assertDestructiveDeleteAllowed('tenant-a', 'stu-other')).resolves.toBeUndefined();
  });

  it('runs erasure status machine and completes when no hold (inline worker path)', async () => {
    const req = await service.createErasureRequest({
      tenantId: 'tenant-a',
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'parent-1',
      requestType: 'anonymization',
    });
    await service.transitionErasureRequest(req.id, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, 'approved', 'officer');
    const done = await service.executeErasure(req.id, 'officer');
    expect(done.status).toBe('completed');
    expect(anonymizer.ledger).toHaveLength(1);
    expect(audit.events.some((e) => e.entityType === 'privacy_erasure')).toBe(true);
  });

  it('blocks erasure execution while legal hold is active (fail-closed)', async () => {
    const req = await service.createErasureRequest({
      tenantId: 'tenant-a',
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'parent-1',
    });
    await service.transitionErasureRequest(req.id, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, 'approved', 'officer');
    await service.placeLegalHold({
      tenantId: 'tenant-a',
      scope: 'subject',
      subjectType: 'student',
      subjectId: 'stu-1',
      reason: 'Litigation',
      placedBy: 'counsel',
    });
    await expect(service.executeErasure(req.id, 'officer')).rejects.toThrow(/legal hold/i);
    expect((await service.getErasureRequest(req.id))?.status).toBe('blocked_legal_hold');
  });

  it('rejects invalid erasure transitions', async () => {
    const req = await service.createErasureRequest({
      tenantId: 'tenant-a',
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'parent-1',
    });
    await expect(service.transitionErasureRequest(req.id, 'completed', 'officer')).rejects.toThrow(
      BusinessRuleError,
    );
  });
});

describe('PrivacyService correction path with audit (W1-SEC-06)', () => {
  let service: PrivacyService;
  let audit: RecordingPrivacyAuditPort;

  beforeEach(() => {
    audit = new RecordingPrivacyAuditPort();
    service = new PrivacyService(new InMemoryPrivacyRepository(), { audit });
  });

  it('applies correction with before/after audit', async () => {
    const req = await service.createCorrectionRequest({
      tenantId: 'tenant-a',
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'legalName',
      currentValue: 'Jon',
      requestedValue: 'John',
      reason: 'Spelling error',
      requestedBy: 'parent-1',
    });
    await service.transitionCorrectionRequest(req.id, 'under_review', 'officer');
    await service.transitionCorrectionRequest(req.id, 'approved', 'officer');
    const applied = await service.applyCorrection(req.id, 'officer');
    expect(applied.status).toBe('applied');
    expect(applied.appliedAt).toBeTruthy();

    const applyAudit = audit.events.find(
      (e) => e.entityType === 'privacy_correction' && e.operation === 'UPDATE',
    );
    expect(applyAudit).toBeTruthy();
    expect(applyAudit?.beforeValues).toMatchObject({ fieldPath: 'legalName', value: 'Jon' });
    expect(applyAudit?.afterValues).toMatchObject({ fieldPath: 'legalName', value: 'John' });
  });

  it('rejects apply when not approved', async () => {
    const req = await service.createCorrectionRequest({
      tenantId: 'tenant-a',
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'email',
      requestedValue: 'fixed@example.com',
      requestedBy: 'parent-1',
    });
    await expect(service.applyCorrection(req.id, 'officer')).rejects.toThrow(BusinessRuleError);
  });
});

describe('PrivacyService tenant offboard wipe (W1-SEC-06)', () => {
  let service: PrivacyService;
  let audit: RecordingPrivacyAuditPort;

  beforeEach(() => {
    audit = new RecordingPrivacyAuditPort();
    service = new PrivacyService(new InMemoryPrivacyRepository(), { audit });
  });

  it('completes offboard checklist with honest residual when no hold', async () => {
    const job = await service.requestTenantOffboardWipe({
      tenantId: 'tenant-a',
      reason: 'Contract ended',
      requestedBy: 'ops',
    });
    expect(job.status).toBe('completed');
    expect(job.checklist.length).toBeGreaterThan(0);
    expect(job.checklist.every((c) => c.status === 'residual')).toBe(true);
    expect(job.residualNote).toMatch(/residual/i);
    expect(audit.events.some((e) => e.entityType === 'privacy_offboard')).toBe(true);
  });

  it('fail-closed offboard when tenant legal hold is active', async () => {
    await service.placeLegalHold({
      tenantId: 'tenant-a',
      scope: 'tenant',
      reason: 'Litigation',
      placedBy: 'counsel',
    });
    await expect(
      service.requestTenantOffboardWipe({
        tenantId: 'tenant-a',
        reason: 'Contract ended',
        requestedBy: 'ops',
      }),
    ).rejects.toThrow(/legal hold/i);
  });

  it('blocks in-flight offboard process when hold placed after queue', async () => {
    const repo = new InMemoryPrivacyRepository();
    const svc = new PrivacyService(repo, { audit });
    // Create job row directly then place hold before process
    const queued = await repo.createTenantOffboardJob({
      id: 'job-1',
      tenantId: 'tenant-a',
      status: 'queued',
      reason: 'wipe',
      requestedBy: 'ops',
      statusReason: null,
      checklist: [],
      residualNote: null,
      startedAt: null,
      completedAt: null,
    });
    await svc.placeLegalHold({
      tenantId: 'tenant-a',
      scope: 'tenant',
      reason: 'Hold',
      placedBy: 'counsel',
    });
    await expect(svc.processTenantOffboardJob(queued.id)).rejects.toThrow(/legal hold/i);
    expect((await svc.getTenantOffboardJob(queued.id))?.status).toBe('blocked_legal_hold');
  });
});
