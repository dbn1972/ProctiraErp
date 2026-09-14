import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { PrivacyService } from './privacy-service.js';

describe('PrivacyService legal hold + erasure (W1-SEC-06)', () => {
  let service: PrivacyService;
  beforeEach(() => { service = new PrivacyService(new InMemoryPrivacyRepository()); });

  it('places and releases a tenant-scope legal hold', async () => {
    const hold = await service.placeLegalHold({ tenantId: 'tenant-a', scope: 'tenant', reason: 'Litigation hold', placedBy: 'counsel-1' });
    expect(hold.active).toBe(true);
    expect(await service.isOnLegalHold('tenant-a')).toBe(true);
    expect((await service.releaseLegalHold(hold.id, 'counsel-1')).active).toBe(false);
  });

  it('blocks destructive delete while tenant legal hold is active', async () => {
    await service.placeLegalHold({ tenantId: 'tenant-a', scope: 'tenant', reason: 'Preservation order', placedBy: 'ops' });
    await expect(service.assertDestructiveDeleteAllowed('tenant-a')).rejects.toThrow(/legal hold/i);
  });

  it('blocks subject destructive delete when subject hold is active', async () => {
    await service.placeLegalHold({ tenantId: 'tenant-a', scope: 'subject', subjectType: 'student', subjectId: 'stu-1', reason: 'Investigation', placedBy: 'dsar-officer' });
    await expect(service.assertDestructiveDeleteAllowed('tenant-a', 'stu-1')).rejects.toThrow(BusinessRuleError);
    await expect(service.assertDestructiveDeleteAllowed('tenant-a', 'stu-other')).resolves.toBeUndefined();
  });

  it('runs erasure status machine and completes when no hold', async () => {
    const req = await service.createErasureRequest({ tenantId: 'tenant-a', subjectType: 'student', subjectId: 'stu-1', requestedBy: 'parent-1', requestType: 'anonymization' });
    await service.transitionErasureRequest(req.id, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, 'approved', 'officer');
    const done = await service.executeErasure(req.id, 'officer');
    expect(done.status).toBe('completed');
  });

  it('blocks erasure execution while legal hold is active (fail-closed)', async () => {
    const req = await service.createErasureRequest({ tenantId: 'tenant-a', subjectType: 'student', subjectId: 'stu-1', requestedBy: 'parent-1' });
    await service.transitionErasureRequest(req.id, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, 'approved', 'officer');
    await service.placeLegalHold({ tenantId: 'tenant-a', scope: 'subject', subjectType: 'student', subjectId: 'stu-1', reason: 'Litigation', placedBy: 'counsel' });
    await expect(service.executeErasure(req.id, 'officer')).rejects.toThrow(/legal hold/i);
    expect((await service.getErasureRequest(req.id))?.status).toBe('blocked_legal_hold');
  });

  it('rejects invalid erasure transitions', async () => {
    const req = await service.createErasureRequest({ tenantId: 'tenant-a', subjectType: 'student', subjectId: 'stu-1', requestedBy: 'parent-1' });
    await expect(service.transitionErasureRequest(req.id, 'completed', 'officer')).rejects.toThrow(BusinessRuleError);
  });
});
