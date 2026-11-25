/**
 * PRC-L136: legal-hold release and correction transitions are compare-and-set.
 *
 * Two callers that read the same state concurrently must not both write: the
 * second write misses the guard and gets 409, and only one audit row exists.
 * The in-memory repository applies the same guard as the Postgres UPDATE
 * (`WHERE active = $6` / `WHERE status = $9`); the live suite proves the SQL.
 */
import { ConflictError, NotFoundError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { CompositeCorrectionApplier, type CorrectionApplier } from './correction-applier.js';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { RecordingPrivacyAuditPort } from './privacy-audit.js';
import { PrivacyService } from './privacy-service.js';

const TENANT = 'tenant-a';

function settledCounts(results: PromiseSettledResult<unknown>[]) {
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return {
    fulfilled: results.filter((r) => r.status === 'fulfilled').length,
    conflicts: rejected.filter((r) => r.reason instanceof ConflictError).length,
  };
}

describe('PRC-L136 legal hold release is conditional', () => {
  let audit: RecordingPrivacyAuditPort;
  let service: PrivacyService;

  beforeEach(() => {
    audit = new RecordingPrivacyAuditPort();
    service = new PrivacyService(new InMemoryPrivacyRepository(), { audit });
  });

  it('two concurrent releases: one succeeds, the other gets 409, one audit row', async () => {
    const hold = await service.placeLegalHold({
      tenantId: TENANT,
      scope: 'tenant',
      reason: 'Litigation hold',
      placedBy: 'counsel-1',
    });
    const results = await Promise.allSettled([
      service.releaseLegalHold(hold.id, TENANT, 'counsel-2'),
      service.releaseLegalHold(hold.id, TENANT, 'counsel-3'),
    ]);
    expect(settledCounts(results)).toEqual({ fulfilled: 1, conflicts: 1 });
    const releases = audit.events.filter(
      (e) => e.entityType === 'privacy_legal_hold' && e.operation === 'UPDATE',
    );
    expect(releases).toHaveLength(1);
  });
});

describe('PRC-L136 correction transitions are conditional', () => {
  let audit: RecordingPrivacyAuditPort;
  let service: PrivacyService;
  let writes: number;
  const store = new Map<string, Record<string, unknown>>();
  const applier: CorrectionApplier = {
    allowedFieldPaths: (subjectType) => (subjectType === 'student' ? ['email'] : []),
    async readCurrentValue({ subjectId, fieldPath }) {
      const row = store.get(subjectId);
      if (!row) throw new NotFoundError(`student ${subjectId}`);
      return row[fieldPath] == null ? null : String(row[fieldPath]);
    },
    async applyValue({ subjectId, fieldPath, value }) {
      const row = store.get(subjectId);
      if (!row) throw new NotFoundError(`student ${subjectId}`);
      writes += 1;
      row[fieldPath] = value;
    },
  };

  beforeEach(() => {
    audit = new RecordingPrivacyAuditPort();
    writes = 0;
    store.set('stu-1', { email: 'old@example.com' });
    service = new PrivacyService(new InMemoryPrivacyRepository(), {
      audit,
      correctionApplier: new CompositeCorrectionApplier({ student: applier }),
    });
  });

  async function correctionUnderReview() {
    const req = await service.createCorrectionRequest({
      tenantId: TENANT,
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'email',
      requestedValue: 'new@example.com',
      requestedBy: 'parent-1',
    });
    await service.transitionCorrectionRequest(req.id, TENANT, 'under_review', 'officer');
    return req;
  }

  function decisionAudits(status: string) {
    return audit.events.filter(
      (e) => e.entityType === 'privacy_correction' && e.afterValues?.status === status,
    );
  }

  it('concurrent approve and reject: exactly one decision is written', async () => {
    const req = await correctionUnderReview();
    const results = await Promise.allSettled([
      service.transitionCorrectionRequest(req.id, TENANT, 'approved', 'officer-1'),
      service.transitionCorrectionRequest(req.id, TENANT, 'rejected', 'officer-2'),
    ]);
    expect(settledCounts(results)).toEqual({ fulfilled: 1, conflicts: 1 });
    expect(decisionAudits('approved').length + decisionAudits('rejected').length).toBe(1);
    const final = await service.getCorrectionRequest(req.id, TENANT);
    const winner = results.findIndex((r) => r.status === 'fulfilled');
    expect(final?.status).toBe(winner === 0 ? 'approved' : 'rejected');
  });

  it('concurrent apply: one request is marked applied once, the other gets 409', async () => {
    const req = await correctionUnderReview();
    await service.transitionCorrectionRequest(req.id, TENANT, 'approved', 'officer');
    const results = await Promise.allSettled([
      service.applyCorrection(req.id, TENANT, 'officer-1'),
      service.applyCorrection(req.id, TENANT, 'officer-2'),
    ]);
    expect(settledCounts(results)).toEqual({ fulfilled: 1, conflicts: 1 });
    expect(decisionAudits('applied')).toHaveLength(1);
    expect((await service.getCorrectionRequest(req.id, TENANT))?.status).toBe('applied');
    expect(store.get('stu-1')?.email).toBe('new@example.com');
    // Both callers passed the status read before either wrote; the domain value is
    // the same idempotent write, recorded here so a change in that behaviour is seen.
    expect(writes).toBe(2);
  });
});
