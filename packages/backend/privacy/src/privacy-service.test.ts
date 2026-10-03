import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createPrivacyRepository, isPgPrivacyEnabled } from './create-privacy-repository.js';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { CompositeCorrectionApplier, type CorrectionApplier } from './correction-applier.js';
import { RecordingPrivacyAuditPort } from './privacy-audit.js';
import { PrivacyService } from './privacy-service.js';
import { resetSharedInMemoryPrivacyRepositoryForTests } from './shared-store.js';
import {
  RecordingSubjectAnonymizer,
  ResidualTenantWipeExecutor,
  type SubjectAnonymizer,
  type TenantWipeExecutor,
} from './subject-anonymizer.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

describe('PrivacyService legal hold + erasure (W1-SEC-06)', () => {
  let repository: InMemoryPrivacyRepository;
  let service: PrivacyService;
  let audit: RecordingPrivacyAuditPort;
  let anonymizer: RecordingSubjectAnonymizer;

  beforeEach(() => {
    repository = new InMemoryPrivacyRepository();
    audit = new RecordingPrivacyAuditPort();
    anonymizer = new RecordingSubjectAnonymizer();
    service = new PrivacyService(repository, { audit, anonymizer });
  });

  it('places and releases a tenant-scope legal hold with audit', async () => {
    const hold = await service.placeLegalHold({
      tenantId: TENANT_A,
      scope: 'tenant',
      reason: 'Litigation hold',
      placedBy: 'counsel-1',
    });
    expect(hold.active).toBe(true);
    expect(await service.isOnLegalHold(TENANT_A)).toBe(true);
    expect((await service.releaseLegalHold(hold.id, TENANT_A, 'counsel-1')).active).toBe(false);
    expect(audit.events.some((e) => e.entityType === 'privacy_legal_hold')).toBe(true);
  });

  it('blocks destructive delete while tenant legal hold is active', async () => {
    await service.placeLegalHold({
      tenantId: TENANT_A,
      scope: 'tenant',
      reason: 'Preservation order',
      placedBy: 'ops',
    });
    await expect(service.assertDestructiveDeleteAllowed(TENANT_A)).rejects.toThrow(/legal hold/i);
  });

  it('blocks subject destructive delete when subject hold is active', async () => {
    await service.placeLegalHold({
      tenantId: TENANT_A,
      scope: 'subject',
      subjectType: 'student',
      subjectId: 'stu-1',
      reason: 'Investigation',
      placedBy: 'dsar-officer',
    });
    await expect(service.assertDestructiveDeleteAllowed(TENANT_A, 'stu-1')).rejects.toThrow(
      BusinessRuleError,
    );
    await expect(
      service.assertDestructiveDeleteAllowed(TENANT_A, 'stu-other'),
    ).resolves.toBeUndefined();
  });

  it('fail-closes anonymization job to failed when residual anonymizer leaves residuals', async () => {
    const req = await service.createErasureRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'parent-1',
      requestType: 'anonymization',
    });
    await service.transitionErasureRequest(req.id, TENANT_A, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, TENANT_A, 'approved', 'officer');
    const done = await service.executeErasure(req.id, TENANT_A, 'officer');
    // Erasure must not claim completed wipe when residuals remain; PRC-M320: it returns to
    // `approved` so execution can be retried.
    expect(done.status).toBe('approved');
    expect(done.statusReason).toMatch(/residual|cascade/i);
    const jobs = await repository.listAnonymizationJobs(TENANT_A);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('failed');
    expect(jobs[0]?.residualNote).toBeTruthy();
    expect(anonymizer.ledger).toHaveLength(1);
    expect(audit.events.some((e) => e.entityType === 'privacy_erasure')).toBe(true);
  });

  it('completes erasure when anonymizer returns no residual', async () => {
    const clean: SubjectAnonymizer = {
      async anonymize() {
        return { fieldsTouched: ['display_name', 'email'] };
      },
    };
    const svc = new PrivacyService(repository, { audit, anonymizer: clean });
    const req = await svc.createErasureRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-2',
      requestedBy: 'parent-1',
      requestType: 'anonymization',
    });
    await svc.transitionErasureRequest(req.id, TENANT_A, 'under_review', 'officer');
    await svc.transitionErasureRequest(req.id, TENANT_A, 'approved', 'officer');
    const done = await svc.executeErasure(req.id, TENANT_A, 'officer');
    expect(done.status).toBe('completed');
    const jobs = await repository.listAnonymizationJobs(TENANT_A);
    expect(jobs.some((j) => j.status === 'completed' && !j.residualNote)).toBe(true);
  });

  it('blocks erasure execution while legal hold is active (fail-closed)', async () => {
    const req = await service.createErasureRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'parent-1',
    });
    await service.transitionErasureRequest(req.id, TENANT_A, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, TENANT_A, 'approved', 'officer');
    await service.placeLegalHold({
      tenantId: TENANT_A,
      scope: 'subject',
      subjectType: 'student',
      subjectId: 'stu-1',
      reason: 'Litigation',
      placedBy: 'counsel',
    });
    await expect(service.executeErasure(req.id, TENANT_A, 'officer')).rejects.toThrow(
      /legal hold/i,
    );
    expect((await service.getErasureRequest(req.id, TENANT_A))?.status).toBe('blocked_legal_hold');
  });

  it('rejects invalid erasure transitions', async () => {
    const req = await service.createErasureRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'parent-1',
    });
    await expect(
      service.transitionErasureRequest(req.id, TENANT_A, 'completed', 'officer'),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('cross-tenant id lookup returns not-found (IDOR fail-closed)', async () => {
    const hold = await service.placeLegalHold({
      tenantId: TENANT_A,
      scope: 'tenant',
      reason: 'Hold',
      placedBy: 'counsel',
    });
    await expect(service.releaseLegalHold(hold.id, TENANT_B, 'counsel')).rejects.toThrow(
      NotFoundError,
    );
    expect(await service.getErasureRequest(hold.id, TENANT_B)).toBeNull();

    const req = await service.createErasureRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'parent-1',
    });
    expect(await service.getErasureRequest(req.id, TENANT_B)).toBeNull();
    await expect(
      service.transitionErasureRequest(req.id, TENANT_B, 'under_review', 'officer'),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('PrivacyService correction path with audit (W1-SEC-06)', () => {
  let service: PrivacyService;
  let audit: RecordingPrivacyAuditPort;

  // PRC-M321: a fake owning domain (student store) behind the CorrectionApplier port.
  let studentStore: Map<string, Record<string, string>>;
  let failWrite: boolean;
  const studentApplier: CorrectionApplier = {
    allowedFieldPaths: (subjectType) => (subjectType === 'student' ? ['legalName', 'email'] : []),
    async readCurrentValue({ subjectId, fieldPath }) {
      const row = studentStore.get(subjectId);
      if (!row) throw new NotFoundError(`student ${subjectId}`);
      return row[fieldPath] ?? null;
    },
    async applyValue({ subjectId, fieldPath, value }) {
      if (failWrite) throw new Error('student write failed');
      const row = studentStore.get(subjectId);
      if (!row) throw new NotFoundError(`student ${subjectId}`);
      row[fieldPath] = value;
    },
  };

  beforeEach(() => {
    audit = new RecordingPrivacyAuditPort();
    studentStore = new Map([['stu-1', { legalName: 'Jon', email: 'old@example.com' }]]);
    failWrite = false;
    service = new PrivacyService(new InMemoryPrivacyRepository(), {
      audit,
      correctionApplier: new CompositeCorrectionApplier({ student: studentApplier }),
    });
  });

  async function approvedCorrection(fieldPath = 'email', requestedValue = 'new@example.com') {
    const req = await service.createCorrectionRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath,
      // Client-claimed current value is not trusted for audit.
      currentValue: 'client-claimed',
      requestedValue,
      requestedBy: 'parent-1',
    });
    await service.transitionCorrectionRequest(req.id, TENANT_A, 'under_review', 'officer');
    await service.transitionCorrectionRequest(req.id, TENANT_A, 'approved', 'officer');
    return req;
  }

  it('apply changes the student field; audit before digest is server-read (PRC-M321)', async () => {
    const req = await approvedCorrection();
    const applied = await service.applyCorrection(req.id, TENANT_A, 'officer');
    expect(applied.status).toBe('applied');
    expect(studentStore.get('stu-1')?.email).toBe('new@example.com');
    const ev = audit.events.find(
      (e) => e.entityType === 'privacy_correction' && e.afterValues?.status === 'applied',
    );
    const { createHash } = await import('node:crypto');
    const digest = (v: string) =>
      `sha256:${createHash('sha256').update(`${TENANT_A}\u0000${v}`).digest('hex')}`;
    expect(ev?.beforeValues?.valueDigest).toBe(digest('old@example.com'));
    expect(ev?.afterValues?.valueDigest).toBe(digest('new@example.com'));
  });

  it('unknown fieldPath is rejected with 400 (PRC-M321)', async () => {
    await expect(
      service.createCorrectionRequest({
        tenantId: TENANT_A,
        subjectType: 'student',
        subjectId: 'stu-1',
        fieldPath: 'passwordHash',
        requestedValue: 'x',
        requestedBy: 'parent-1',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('failed domain write leaves the correction approved (PRC-M321)', async () => {
    const req = await approvedCorrection();
    failWrite = true;
    await expect(service.applyCorrection(req.id, TENANT_A, 'officer')).rejects.toThrow(
      /write failed/,
    );
    expect((await service.getCorrectionRequest(req.id, TENANT_A))?.status).toBe('approved');
  });

  it('without an applier apply refuses with 501 and does not report applied', async () => {
    const repo = new InMemoryPrivacyRepository();
    const bare = new PrivacyService(repo, { audit });
    const req = await bare.createCorrectionRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'email',
      requestedValue: 'x@example.com',
      requestedBy: 'parent-1',
    });
    await bare.transitionCorrectionRequest(req.id, TENANT_A, 'under_review', 'officer');
    await bare.transitionCorrectionRequest(req.id, TENANT_A, 'approved', 'officer');
    await expect(bare.applyCorrection(req.id, TENANT_A, 'officer')).rejects.toMatchObject({
      statusCode: 501,
    });
    expect((await bare.getCorrectionRequest(req.id, TENANT_A))?.status).toBe('approved');
  });

  it('applies correction with before/after audit', async () => {
    const req = await service.createCorrectionRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'legalName',
      currentValue: 'Jon',
      requestedValue: 'John',
      reason: 'Spelling error',
      requestedBy: 'parent-1',
    });
    await service.transitionCorrectionRequest(req.id, TENANT_A, 'under_review', 'officer');
    await service.transitionCorrectionRequest(req.id, TENANT_A, 'approved', 'officer');
    const applied = await service.applyCorrection(req.id, TENANT_A, 'officer');
    expect(applied.status).toBe('applied');
    expect(applied.appliedAt).toBeTruthy();

    const applyAudit = audit.events.find(
      (e) => e.entityType === 'privacy_correction' && e.operation === 'UPDATE',
    );
    expect(applyAudit).toBeTruthy();
    expect(applyAudit?.beforeValues).toMatchObject({ fieldPath: 'legalName' });
    expect(applyAudit?.afterValues).toMatchObject({ fieldPath: 'legalName' });
    // PRC-M322: audit carries digests, never the raw values.
    expect(String(applyAudit?.afterValues?.valueDigest)).toMatch(/^sha256:[0-9a-f]{64}$/);
    const allAudit = JSON.stringify(audit.events);
    expect(allAudit).not.toContain('John');
    expect(allAudit).not.toContain('"Jon"');
    // ...and the stored row no longer keeps the values after apply.
    const stored = await service.getCorrectionRequest(req.id, TENANT_A);
    expect(stored?.currentValue).toBeNull();
    expect(stored?.requestedValue).toBe('[REDACTED]');
  });

  it('erasure of the subject redacts correction values (PRC-M322)', async () => {
    const repository = new InMemoryPrivacyRepository();
    const svc = new PrivacyService(repository, {
      audit,
      anonymizer: { anonymize: async () => ({ fieldsTouched: ['email'] }) },
    });
    const corr = await svc.createCorrectionRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-9',
      fieldPath: 'email',
      currentValue: 'old@example.com',
      requestedValue: 'secret-new@example.com',
      requestedBy: 'parent-1',
    });
    const other = await svc.createCorrectionRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-other',
      fieldPath: 'email',
      requestedValue: 'keep@example.com',
      requestedBy: 'parent-1',
    });
    const er = await svc.createErasureRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-9',
      requestedBy: 'parent-1',
    });
    await svc.transitionErasureRequest(er.id, TENANT_A, 'under_review', 'officer');
    await svc.transitionErasureRequest(er.id, TENANT_A, 'approved', 'officer');
    expect((await svc.executeErasure(er.id, TENANT_A, 'officer')).status).toBe('completed');
    const redacted = await svc.getCorrectionRequest(corr.id, TENANT_A);
    expect(redacted?.currentValue).toBeNull();
    expect(redacted?.requestedValue).toBe('[REDACTED]');
    expect((await svc.getCorrectionRequest(other.id, TENANT_A))?.requestedValue).toBe(
      'keep@example.com',
    );
    expect(JSON.stringify(audit.events)).not.toContain('secret-new@example.com');
  });

  it('rejects apply when not approved', async () => {
    const req = await service.createCorrectionRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'email',
      requestedValue: 'fixed@example.com',
      requestedBy: 'parent-1',
    });
    await expect(service.applyCorrection(req.id, TENANT_A, 'officer')).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('cross-tenant correction id returns not-found', async () => {
    const req = await service.createCorrectionRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'email',
      requestedValue: 'fixed@example.com',
      requestedBy: 'parent-1',
    });
    expect(await service.getCorrectionRequest(req.id, TENANT_B)).toBeNull();
    await expect(
      service.transitionCorrectionRequest(req.id, TENANT_B, 'under_review', 'officer'),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('PrivacyService tenant offboard wipe (W1-SEC-06)', () => {
  let service: PrivacyService;
  let audit: RecordingPrivacyAuditPort;

  beforeEach(() => {
    audit = new RecordingPrivacyAuditPort();
    service = new PrivacyService(new InMemoryPrivacyRepository(), {
      audit,
      tenantWipeExecutor: new ResidualTenantWipeExecutor(),
    });
  });

  it('marks offboard failed (not completed) when residual wipe executor leaves residuals', async () => {
    const job = await service.requestTenantOffboardWipe({
      tenantId: TENANT_A,
      reason: 'Contract ended',
      requestedBy: 'ops',
    });
    expect(job.status).toBe('failed');
    expect(job.checklist.length).toBeGreaterThan(0);
    expect(job.checklist.every((c) => c.status === 'residual')).toBe(true);
    expect(job.residualNote).toMatch(/residual/i);
    expect(audit.events.some((e) => e.entityType === 'privacy_offboard')).toBe(true);
  });

  it('completes offboard when wipe executor reports only completed/skipped domains', async () => {
    const cleanWipe: TenantWipeExecutor = {
      async wipe() {
        return [
          { domain: 'students', status: 'completed' },
          { domain: 'staff', status: 'skipped', note: 'n/a' },
        ];
      },
    };
    const svc = new PrivacyService(new InMemoryPrivacyRepository(), {
      audit,
      tenantWipeExecutor: cleanWipe,
    });
    const job = await svc.requestTenantOffboardWipe({
      tenantId: TENANT_A,
      reason: 'Contract ended',
      requestedBy: 'ops',
    });
    expect(job.status).toBe('completed');
    expect(job.residualNote).toBeNull();
    expect(job.checklist.every((c) => c.status === 'completed' || c.status === 'skipped')).toBe(
      true,
    );
  });

  it('fail-closed offboard when tenant legal hold is active', async () => {
    await service.placeLegalHold({
      tenantId: TENANT_A,
      scope: 'tenant',
      reason: 'Litigation',
      placedBy: 'counsel',
    });
    await expect(
      service.requestTenantOffboardWipe({
        tenantId: TENANT_A,
        reason: 'Contract ended',
        requestedBy: 'ops',
      }),
    ).rejects.toThrow(/legal hold/i);
  });

  it('blocks in-flight offboard process when hold placed after queue', async () => {
    const repo = new InMemoryPrivacyRepository();
    const svc = new PrivacyService(repo, { audit });
    const queued = await repo.createTenantOffboardJob({
      id: 'job-1',
      tenantId: TENANT_A,
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
      tenantId: TENANT_A,
      scope: 'tenant',
      reason: 'Hold',
      placedBy: 'counsel',
    });
    await expect(svc.processTenantOffboardJob(queued.id, TENANT_A)).rejects.toThrow(/legal hold/i);
    expect((await svc.getTenantOffboardJob(queued.id, TENANT_A))?.status).toBe(
      'blocked_legal_hold',
    );
  });

  it('cross-tenant offboard id returns not-found', async () => {
    const repo = new InMemoryPrivacyRepository();
    const svc = new PrivacyService(repo, { audit });
    const queued = await repo.createTenantOffboardJob({
      id: 'job-x',
      tenantId: TENANT_A,
      status: 'queued',
      reason: 'wipe',
      requestedBy: 'ops',
      statusReason: null,
      checklist: [],
      residualNote: null,
      startedAt: null,
      completedAt: null,
    });
    expect(await svc.getTenantOffboardJob(queued.id, TENANT_B)).toBeNull();
    await expect(svc.processTenantOffboardJob(queued.id, TENANT_B)).rejects.toThrow(NotFoundError);
  });
});

describe('createPrivacyRepository memory path (W1-SEC-06)', () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevRequire = process.env.REQUIRE_DATABASE;

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevRequire === undefined) delete process.env.REQUIRE_DATABASE;
    else process.env.REQUIRE_DATABASE = prevRequire;
    resetSharedInMemoryPrivacyRepositoryForTests();
  });

  it('returns shared in-memory repository when DATABASE_URL is unset', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REQUIRE_DATABASE;
    process.env.NODE_ENV = 'test';
    expect(isPgPrivacyEnabled()).toBe(false);
    const a = createPrivacyRepository();
    const b = createPrivacyRepository();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(InMemoryPrivacyRepository);
  });
});
