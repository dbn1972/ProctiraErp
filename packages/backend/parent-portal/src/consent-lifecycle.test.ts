/**
 * W1-PRIV-01 COMPLETE — parent consent append-only lifecycle (immutability +
 * withdraw / supersede with effective dating).
 */
import { BusinessRuleError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { ParentPortalService } from './parent-portal-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const PARENT = 'parent-user-1';
const HOUSEHOLD = '33333333-3333-4333-8333-333333333333';

describe('W1-PRIV-01 COMPLETE consent lifecycle', () => {
  let repo: InMemoryParentPortalRepository;
  let service: ParentPortalService;

  async function provisionParent() {
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
    await service.linkChild(TENANT, PARENT, {
      studentId: STUDENT,
      householdId: HOUSEHOLD,
      relationship: 'mother',
      isPrimary: true,
      canConsentMedical: true,
      canViewFees: true,
    });
  }

  beforeEach(async () => {
    repo = new InMemoryParentPortalRepository();
    service = new ParentPortalService(repo);
    await provisionParent();
  });

  it('decide appends a successor version and leaves the prior readable', async () => {
    const pending = await service.createConsentRequest(TENANT, 'staff', {
      studentId: STUDENT,
      parentUserId: PARENT,
      consentType: 'photo_media',
      title: 'Photo consent',
      description: 'School photos',
      consentVersion: 'photo-v1',
    });
    expect(pending.version).toBe(1);
    expect(pending.validTo).toBeNull();

    const decided = await service.decideConsent(TENANT, PARENT, pending.id, {
      status: 'approved',
    });
    expect(decided.version).toBe(2);
    expect(decided.status).toBe('approved');
    expect(decided.supersedesId).toBe(pending.id);
    expect(decided.consentChainId).toBe(pending.consentChainId);
    expect(decided.consentVersion).toBe('photo-v1');
    expect(decided.decidedAt).not.toBeNull();

    const prior = await repo.findConsentById(pending.id, TENANT);
    expect(prior?.status).toBe('pending');
    expect(prior?.validTo).not.toBeNull();
    expect(prior?.title).toBe('Photo consent');

    const history = await service.listConsentHistory(TENANT, PARENT, decided.id);
    expect(history.map((v) => v.version)).toEqual([1, 2]);
    expect(history[0]!.status).toBe('pending');
    expect(history[1]!.status).toBe('approved');

    const listed = await service.listConsentsForParent(TENANT, PARENT);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(decided.id);
  });

  it('withdraw appends a revoked successor with effective dating', async () => {
    const pending = await service.createConsentRequest(TENANT, 'staff', {
      studentId: STUDENT,
      parentUserId: PARENT,
      consentType: 'data_sharing',
      title: 'Data sharing',
      consentVersion: 'data-v1',
    });
    const approved = await service.decideConsent(TENANT, PARENT, pending.id, {
      status: 'approved',
    });

    const withdrawn = await service.withdrawConsent(TENANT, PARENT, approved.id, {
      reason: 'parent request',
    });
    expect(withdrawn.status).toBe('revoked');
    expect(withdrawn.version).toBe(3);
    expect(withdrawn.supersedesId).toBe(approved.id);

    const closedApproved = await repo.findConsentById(approved.id, TENANT);
    expect(closedApproved?.validTo).not.toBeNull();
    expect(closedApproved?.status).toBe('approved');

    const history = await service.listConsentHistory(TENANT, PARENT, withdrawn.id);
    expect(history).toHaveLength(3);
    expect(history.map((v) => v.status)).toEqual(['pending', 'approved', 'revoked']);
  });

  it('supersede appends a pending successor with a new consentVersion', async () => {
    const pending = await service.createConsentRequest(TENANT, 'staff', {
      studentId: STUDENT,
      parentUserId: PARENT,
      consentType: 'field_trip',
      title: 'Field trip 2025',
      consentVersion: 'trip-2025',
    });
    const approved = await service.decideConsent(TENANT, PARENT, pending.id, {
      status: 'approved',
    });

    const next = await service.supersedeConsent(TENANT, 'staff', approved.id, {
      consentVersion: 'trip-2026',
      title: 'Field trip 2026',
    });
    expect(next.status).toBe('pending');
    expect(next.version).toBe(3);
    expect(next.consentVersion).toBe('trip-2026');
    expect(next.title).toBe('Field trip 2026');
    expect(next.supersedesId).toBe(approved.id);

    const prior = await repo.findConsentById(approved.id, TENANT);
    expect(prior?.consentVersion).toBe('trip-2025');
    expect(prior?.validTo).not.toBeNull();
  });

  it('refuses mutating historical consent bodies via service guard', () => {
    expect(() => service.refuseConsentBodyMutation()).toThrow(BusinessRuleError);
    expect(() => service.refuseConsentBodyMutation()).toThrow(/immutable/i);
  });

  it('refuses operating on a closed historical version', async () => {
    const pending = await service.createConsentRequest(TENANT, 'staff', {
      studentId: STUDENT,
      parentUserId: PARENT,
      consentType: 'photo_media',
      title: 'Photo',
      consentVersion: 'photo-v1',
    });
    await service.decideConsent(TENANT, PARENT, pending.id, { status: 'approved' });

    await expect(
      service.decideConsent(TENANT, PARENT, pending.id, { status: 'denied' }),
    ).rejects.toThrow(/closed|already been decided/i);

    await expect(service.withdrawConsent(TENANT, PARENT, pending.id, {})).rejects.toThrow(
      /closed/i,
    );
  });
});
