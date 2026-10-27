/**
 * PRC-M315 — concurrent-decide atomicity.
 *
 * Before the fix, decideConsent/withdrawConsent/supersedeConsent ran a separate
 * closeConsentValidTo(...) followed by createConsent(...). Two concurrent calls
 * on the same open version could both pass the "is it open?" read, both close it,
 * and both insert a successor — corrupting the chain (two open successors, or an
 * inconsistent closed/open pairing) instead of one caller winning and the other
 * getting a 409.
 *
 * appendConsentVersion(...) makes the close+insert atomic from the caller's
 * perspective: exactly one of two concurrent decideConsent calls on the same
 * open version must succeed, and the other must reject with ConflictError.
 */
import { ConflictError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { ParentPortalService } from './parent-portal-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const PARENT = 'parent-user-1';
const HOUSEHOLD = '33333333-3333-4333-8333-333333333333';

describe('PRC-M315 concurrent consent decision atomicity', () => {
  let repo: InMemoryParentPortalRepository;
  let service: ParentPortalService;

  beforeEach(async () => {
    repo = new InMemoryParentPortalRepository();
    service = new ParentPortalService(repo);
    await service.createHousehold(TENANT, { id: HOUSEHOLD, label: 'H1' });
    await service.addHouseholdMember(TENANT, {
      householdId: HOUSEHOLD,
      parentUserId: PARENT,
      role: 'primary',
    });
    await service.assignStudentCustody(TENANT, {
      studentId: STUDENT,
      householdId: HOUSEHOLD,
      custodyType: 'sole',
    });
    await service.linkChild(
      TENANT,
      PARENT,
      {
        studentId: STUDENT,
        householdId: HOUSEHOLD,
        relationship: 'mother',
        isPrimary: true,
        canConsentMedical: true,
        canViewFees: true,
      },
      { isStaff: true },
    );
  });

  it('exactly one of two concurrent decideConsent calls succeeds; the other throws ConflictError', async () => {
    const pending = await service.createConsentRequest(TENANT, 'staff', {
      studentId: STUDENT,
      parentUserId: PARENT,
      consentType: 'photo_media',
      title: 'Photo consent',
      consentVersion: 'photo-v1',
    });

    // Pre-fix (separate closeConsentValidTo + createConsent calls racing on the
    // same read-then-write window), both of these could resolve 'fulfilled': each
    // call reads the same open version before either writes, both close it, and
    // both insert a successor — producing two 'version 2' rows for the same
    // chain with no caller ever seeing a rejection. That is the bug this test
    // guards against; appendConsentVersion fixes it so exactly one wins.
    const [a, b] = await Promise.allSettled([
      service.decideConsent(TENANT, PARENT, pending.id, { status: 'approved' }),
      service.decideConsent(TENANT, PARENT, pending.id, { status: 'denied' }),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    // The chain must be left in a consistent append-only state: exactly one
    // open (current) version, and the original pending version closed.
    const versions = await repo.listConsentVersions(TENANT, pending.consentChainId);
    const open = versions.filter((v) => v.validTo == null);
    expect(open).toHaveLength(1);
    expect(versions).toHaveLength(2);
  });
});
