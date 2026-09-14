import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '@proctira/common';

import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { ParentPortalService } from './parent-portal-service.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-000000000002';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';
const PARENT_USER = 'parent-a';
const PARENT_PRIMARY = 'parent-primary';
const PARENT_LIMITED = 'parent-limited';
const PARENT_H2 = 'parent-h2';
const STUDENT_S2 = '00000000-0000-4000-8000-000000000098';
const HOUSEHOLD_H1 = '00000000-0000-4000-8000-000000000101';
const HOUSEHOLD_H2 = '00000000-0000-4000-8000-000000000102';

describe('ParentPortalService', () => {
  let repository: InMemoryParentPortalRepository;
  let service: ParentPortalService;

  beforeEach(() => {
    repository = new InMemoryParentPortalRepository();
    service = new ParentPortalService(repository);
  });

  /** W1-SEC-03 COMPLETE: access requires effective custody — provision sole custody + link. */
  async function linkWithSoleCustody(
    parentUserId: string,
    studentId: string,
    opts: {
      householdId?: string;
      relationship?: 'guardian' | 'mother' | 'father' | 'other';
      isPrimary?: boolean;
      canConsentMedical?: boolean;
      canViewFees?: boolean;
    } = {},
  ) {
    const householdId = opts.householdId ?? HOUSEHOLD_H1;
    const existing = await repository.listActiveHouseholdIdsForParent(TENANT_A, parentUserId);
    if (!existing.includes(householdId)) {
      try {
        await service.createHousehold(TENANT_A, { id: householdId, label: `Household ${householdId}` });
      } catch {
        // household may already exist from a prior call in the same test
      }
      await service.addHouseholdMember(TENANT_A, {
        householdId,
        parentUserId,
        role: opts.isPrimary === false ? 'guardian' : 'primary',
      });
    }
    const custodyHouseholds = await repository.listActiveCustodyHouseholdIdsForStudent(
      TENANT_A,
      studentId,
    );
    if (!custodyHouseholds.includes(householdId)) {
      await service.assignStudentCustody(TENANT_A, {
        studentId,
        householdId,
        custodyType: 'sole',
      });
    }
    return service.linkChild(TENANT_A, parentUserId, {
      studentId,
      householdId,
      relationship: opts.relationship,
      isPrimary: opts.isPrimary,
      canConsentMedical: opts.canConsentMedical,
      canViewFees: opts.canViewFees,
    });
  }

  describe('linkChild', () => {
    it('links a parent to a student', async () => {
      const link = await service.linkChild(TENANT_A, PARENT_USER, {
        studentId: STUDENT_ID,
        relationship: 'guardian',
      });

      expect(link.tenantId).toBe(TENANT_A);
      expect(link.parentUserId).toBe(PARENT_USER);
      expect(link.studentId).toBe(STUDENT_ID);
      expect(link.relationship).toBe('guardian');
      expect(link.status).toBe('active');
      expect(link.isPrimary).toBe(true);
      expect(link.canConsentMedical).toBe(true);
      expect(link.canViewFees).toBe(true);
    });

    it('persists explicit authority flags on the link', async () => {
      const link = await service.linkChild(TENANT_A, PARENT_LIMITED, {
        studentId: STUDENT_ID,
        relationship: 'other',
        isPrimary: false,
        canConsentMedical: false,
        canViewFees: false,
      });

      expect(link.isPrimary).toBe(false);
      expect(link.canConsentMedical).toBe(false);
      expect(link.canViewFees).toBe(false);
    });

    it('rejects duplicate active links', async () => {
      await service.linkChild(TENANT_A, PARENT_USER, { studentId: STUDENT_ID });

      await expect(
        service.linkChild(TENANT_A, PARENT_USER, { studentId: STUDENT_ID }),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('messaging', () => {
    beforeEach(async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID);
    });

    it('creates a thread with initial message and supports replies', async () => {
      const { thread, message } = await service.createThread(TENANT_A, PARENT_USER, {
        studentId: STUDENT_ID,
        subject: 'Question about homework',
        body: 'Could you clarify the math assignment?',
      });

      expect(thread.subject).toBe('Question about homework');
      expect(message.body).toBe('Could you clarify the math assignment?');
      expect(message.senderRole).toBe('parent');

      const reply = await service.addMessage(
        TENANT_A,
        PARENT_USER,
        thread.id,
        'Following up on my earlier question.',
      );

      expect(reply.threadId).toBe(thread.id);
      expect(reply.body).toBe('Following up on my earlier question.');

      const messages = await service.listMessages(TENANT_A, PARENT_USER, thread.id);
      expect(messages).toHaveLength(2);
      expect(messages[0]!.body).toBe('Could you clarify the math assignment?');
      expect(messages[1]!.body).toBe('Following up on my earlier question.');
    });

    it('lists threads for the parent', async () => {
      await service.createThread(TENANT_A, PARENT_USER, {
        studentId: STUDENT_ID,
        subject: 'Attendance',
        body: 'Was my child marked present today?',
      });

      const threads = await service.listThreadsForParent(TENANT_A, PARENT_USER);
      expect(threads).toHaveLength(1);
      expect(threads[0]!.subject).toBe('Attendance');
    });
  });

  describe('consent', () => {
    const CONSENT_VERSION = 'photo-media-v2026-01';

    it('requires consentVersion on create and exposes it on read (W1-PRIV-01)', async () => {
      const consent = await service.createConsentRequest(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        consentType: 'photo_media',
        title: 'Photo consent',
        description: 'Allow school photos',
        consentVersion: CONSENT_VERSION,
      });

      expect(consent.consentVersion).toBe(CONSENT_VERSION);

      const listed = await service.listConsentsForParent(TENANT_A, PARENT_USER);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.consentVersion).toBe(CONSENT_VERSION);
    });

    it('allows parent to approve a pending consent', async () => {
      const consent = await service.createConsentRequest(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        consentType: 'photo_media',
        title: 'Photo consent',
        description: 'Allow school photos',
        consentVersion: CONSENT_VERSION,
      });

      expect(consent.status).toBe('pending');

      await linkWithSoleCustody(PARENT_USER, STUDENT_ID);

      const decided = await service.decideConsent(TENANT_A, PARENT_USER, consent.id, {
        status: 'approved',
      });

      expect(decided.status).toBe('approved');
      expect(decided.decidedAt).not.toBeNull();
    });

    it('rejects deciding a consent for another parent', async () => {
      const consent = await service.createConsentRequest(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        consentType: 'field_trip',
        title: 'Field trip',
        consentVersion: 'field-trip-v2026-01',
      });

      await expect(
        service.decideConsent(TENANT_A, 'other-parent', consent.id, { status: 'approved' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('relationship-scoped authority (P0-03)', () => {
    it('allows medical consent decide when canConsentMedical; denies sibling guardian without flag', async () => {
      await linkWithSoleCustody(PARENT_PRIMARY, STUDENT_ID, {
        relationship: 'mother',
        isPrimary: true,
        canConsentMedical: true,
        canViewFees: true,
      });
      await linkWithSoleCustody(PARENT_LIMITED, STUDENT_ID, {
        relationship: 'father',
        isPrimary: false,
        canConsentMedical: false,
        canViewFees: false,
      });

      const medicalPrimary = await service.createConsentRequest(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        parentUserId: PARENT_PRIMARY,
        consentType: 'medical_treatment',
        title: 'Emergency treatment',
        consentVersion: 'medical-v2026-01',
      });
      const medicalLimited = await service.createConsentRequest(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        parentUserId: PARENT_LIMITED,
        consentType: 'medical_treatment',
        title: 'Emergency treatment (limited)',
        consentVersion: 'medical-v2026-01',
      });

      const approved = await service.decideConsent(TENANT_A, PARENT_PRIMARY, medicalPrimary.id, {
        status: 'approved',
      });
      expect(approved.status).toBe('approved');

      await expect(
        service.decideConsent(TENANT_A, PARENT_LIMITED, medicalLimited.id, { status: 'approved' }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows fee view/pay when canViewFees; denies sibling guardian without flag', async () => {
      await linkWithSoleCustody(PARENT_PRIMARY, STUDENT_ID, {
        canConsentMedical: true,
        canViewFees: true,
      });
      await linkWithSoleCustody(PARENT_LIMITED, STUDENT_ID, {
        canConsentMedical: false,
        canViewFees: false,
      });

      const invoice = await service.createInvoice(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        title: 'Term fee',
        amountCents: 10000,
      });

      const visiblePrimary = await service.listInvoicesForParent(TENANT_A, PARENT_PRIMARY);
      const visibleLimited = await service.listInvoicesForParent(TENANT_A, PARENT_LIMITED);
      expect(visiblePrimary.map((row) => row.id)).toEqual([invoice.id]);
      expect(visibleLimited).toHaveLength(0);

      const paid = await service.payInvoice(TENANT_A, PARENT_PRIMARY, invoice.id, {
        method: 'sandbox',
      });
      expect(paid.invoice.status).toBe('paid');

      const invoice2 = await service.createInvoice(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        title: 'Activity fee',
        amountCents: 2500,
      });
      await expect(service.payInvoice(TENANT_A, PARENT_LIMITED, invoice2.id)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('denies medical decide for unlinked parent with 404 (no existence leak)', async () => {
      await linkWithSoleCustody(PARENT_PRIMARY, STUDENT_ID, {
        canConsentMedical: true,
        canViewFees: true,
      });
      const medical = await service.createConsentRequest(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        parentUserId: PARENT_PRIMARY,
        consentType: 'medical_treatment',
        title: 'Emergency',
        consentVersion: 'medical-v2026-01',
      });

      await expect(
        service.decideConsent(TENANT_A, 'stranger', medical.id, { status: 'approved' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('fees sandbox', () => {
    beforeEach(async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID);
    });

    it('creates plan + invoice and lets parent pay with receipt', async () => {
      const plan = await service.createFeePlan(TENANT_A, 'staff-admin', {
        code: 'TERM',
        name: 'Term fee',
        amountCents: 15000,
      });
      expect(plan.amountCents).toBe(15000);

      const invoice = await service.createInvoice(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        planId: plan.id,
        title: 'Term 1',
        amountCents: 15000,
      });

      const paid = await service.payInvoice(TENANT_A, PARENT_USER, invoice.id, {
        method: 'sandbox',
      });
      expect(paid.invoice.status).toBe('paid');
      expect(paid.receipt.amountCents).toBe(15000);
    });

    it('rejects paying an already paid invoice', async () => {
      const invoice = await service.createInvoice(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        title: 'Once',
        amountCents: 1000,
      });
      await service.payInvoice(TENANT_A, PARENT_USER, invoice.id);

      await expect(service.payInvoice(TENANT_A, PARENT_USER, invoice.id)).rejects.toThrow(
        BusinessRuleError,
      );
    });
  });

  describe('household custody authZ (W1-SEC-03)', () => {
    it('allows access when guardian and student share an active custody household', async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID, { householdId: HOUSEHOLD_H1 });

      const children = await service.listChildrenForParent(TENANT_A, PARENT_USER);
      expect(children).toHaveLength(1);

      const { thread } = await service.createThread(TENANT_A, PARENT_USER, {
        studentId: STUDENT_ID,
        subject: 'Same household',
        body: 'Allowed',
      });
      expect(thread.studentId).toBe(STUDENT_ID);
    });

    it('denies cross-household access when custody graph excludes the guardian (404)', async () => {
      await service.createHousehold(TENANT_A, { id: HOUSEHOLD_H1, label: 'Household A' });
      await service.createHousehold(TENANT_A, { id: HOUSEHOLD_H2, label: 'Household B' });
      await service.addHouseholdMember(TENANT_A, {
        householdId: HOUSEHOLD_H1,
        parentUserId: PARENT_USER,
        role: 'primary',
      });
      await service.addHouseholdMember(TENANT_A, {
        householdId: HOUSEHOLD_H2,
        parentUserId: PARENT_H2,
        role: 'primary',
      });
      await service.assignStudentCustody(TENANT_A, {
        studentId: STUDENT_ID,
        householdId: HOUSEHOLD_H1,
        custodyType: 'sole',
      });
      await service.assignStudentCustody(TENANT_A, {
        studentId: STUDENT_S2,
        householdId: HOUSEHOLD_H2,
        custodyType: 'sole',
      });

      await service.linkChild(TENANT_A, PARENT_USER, {
        studentId: STUDENT_ID,
        householdId: HOUSEHOLD_H1,
      });

      // Malicious/stale link: parent in H1 linked to student whose custody is H2 only.
      await repository.createChildLink({
        id: '00000000-0000-4000-8000-000000000201',
        tenantId: TENANT_A,
        parentUserId: PARENT_USER,
        studentId: STUDENT_S2,
        relationship: 'guardian',
        status: 'active',
        isPrimary: false,
        canConsentMedical: true,
        canViewFees: true,
        householdId: HOUSEHOLD_H1,
      });

      await expect(
        service.createThread(TENANT_A, PARENT_USER, {
          studentId: STUDENT_S2,
          subject: 'Cross-household probe',
          body: 'Should not send',
        }),
      ).rejects.toThrow(NotFoundError);

      await expect(service.getChildGrades(TENANT_A, PARENT_USER, STUDENT_S2)).rejects.toThrow(
        NotFoundError,
      );

      const listed = await service.listChildrenForParent(TENANT_A, PARENT_USER);
      expect(listed.map((link) => link.studentId)).toEqual([STUDENT_ID]);
    });

    it('denies access when custody data is missing (fail closed)', async () => {
      await service.linkChild(TENANT_A, PARENT_USER, { studentId: STUDENT_ID });

      const children = await service.listChildrenForParent(TENANT_A, PARENT_USER);
      expect(children).toHaveLength(0);

      await expect(
        service.createThread(TENANT_A, PARENT_USER, {
          studentId: STUDENT_ID,
          subject: 'No custody',
          body: 'Must deny',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('denies access when custody effective window has not started', async () => {
      await service.createHousehold(TENANT_A, { id: HOUSEHOLD_H1, label: 'Future' });
      await service.addHouseholdMember(TENANT_A, {
        householdId: HOUSEHOLD_H1,
        parentUserId: PARENT_USER,
        role: 'primary',
      });
      await service.assignStudentCustody(TENANT_A, {
        studentId: STUDENT_ID,
        householdId: HOUSEHOLD_H1,
        custodyType: 'sole',
        effectiveFrom: new Date(Date.now() + 86_400_000),
      });
      await service.linkChild(TENANT_A, PARENT_USER, {
        studentId: STUDENT_ID,
        householdId: HOUSEHOLD_H1,
      });

      await expect(
        service.createThread(TENANT_A, PARENT_USER, {
          studentId: STUDENT_ID,
          subject: 'Not yet effective',
          body: 'Deny',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('denies all access when an active blocks_all_access restriction applies', async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID);
      await service.createCustodyRestriction(TENANT_A, {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        blocksAllAccess: true,
        blocksMedical: true,
        blocksFees: true,
        courtOrderRef: 'COURT-2026-001',
      });

      expect(await service.listChildrenForParent(TENANT_A, PARENT_USER)).toHaveLength(0);
      await expect(
        service.createThread(TENANT_A, PARENT_USER, {
          studentId: STUDENT_ID,
          subject: 'Restricted',
          body: 'Deny',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('suspends governed medical/fee authority under active restriction even when flags are true', async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID, {
        canConsentMedical: true,
        canViewFees: true,
      });
      await service.createCustodyRestriction(TENANT_A, {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        blocksMedical: true,
        blocksFees: true,
        blocksAllAccess: false,
        courtOrderRef: 'COURT-2026-002',
      });

      // Messaging still allowed (no blocks_all_access).
      const { thread } = await service.createThread(TENANT_A, PARENT_USER, {
        studentId: STUDENT_ID,
        subject: 'Still messaging',
        body: 'OK',
      });
      expect(thread.studentId).toBe(STUDENT_ID);

      const medical = await service.createConsentRequest(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        consentType: 'medical_treatment',
        title: 'Surgery',
        consentVersion: 'medical-v2026-02',
      });
      await expect(
        service.decideConsent(TENANT_A, PARENT_USER, medical.id, { status: 'approved' }),
      ).rejects.toThrow(ForbiddenError);

      const invoice = await service.createInvoice(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        title: 'Restricted fee',
        amountCents: 5000,
      });
      expect(await service.listInvoicesForParent(TENANT_A, PARENT_USER)).toHaveLength(0);
      await expect(service.payInvoice(TENANT_A, PARENT_USER, invoice.id)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe('cross-tenant isolation', () => {
    it('does not expose tenant A data when listing from tenant B', async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID);
      await service.createThread(TENANT_A, PARENT_USER, {
        studentId: STUDENT_ID,
        subject: 'Private thread',
        body: 'Tenant A only',
      });
      await service.createConsentRequest(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        consentType: 'data_sharing',
        title: 'Data sharing',
        consentVersion: 'data-sharing-v2026-01',
      });
      await service.createInvoice(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        title: 'Tenant A invoice',
        amountCents: 10000,
      });

      const childrenB = await service.listChildrenForParent(TENANT_B, PARENT_USER);
      const threadsB = await service.listThreadsForParent(TENANT_B, PARENT_USER);
      const consentsB = await service.listConsentsForParent(TENANT_B, PARENT_USER);
      const invoicesB = await service.listInvoicesForParent(TENANT_B, PARENT_USER);

      expect(childrenB).toHaveLength(0);
      expect(threadsB).toHaveLength(0);
      expect(consentsB).toHaveLength(0);
      expect(invoicesB).toHaveLength(0);
    });

    it('returns 404 when accessing tenant A thread from tenant B', async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID);
      const { thread } = await service.createThread(TENANT_A, PARENT_USER, {
        studentId: STUDENT_ID,
        subject: 'Isolated',
        body: 'Hello',
      });

      await expect(service.listMessages(TENANT_B, PARENT_USER, thread.id)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('academic visibility self-binding', () => {
    const UNLINKED = '00000000-0000-4000-8000-0000000000aa';

    it('returns empty attendance for a linked child and 404 when unlinked', async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID);

      const linked = await service.getChildAttendance(TENANT_A, PARENT_USER, STUDENT_ID);
      expect(linked.data).toEqual([]);
      expect(linked.meta.studentId).toBe(STUDENT_ID);
      expect(linked.summary.percentage).toBeNull();

      await expect(service.getChildAttendance(TENANT_A, PARENT_USER, UNLINKED)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('denies grades, timetable, homework, calendar, and notices for an unlinked child', async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID);

      await expect(service.getChildGrades(TENANT_A, PARENT_USER, UNLINKED)).rejects.toThrow(
        NotFoundError,
      );
      await expect(service.getChildTimetable(TENANT_A, PARENT_USER, UNLINKED)).rejects.toThrow(
        NotFoundError,
      );
      await expect(service.getChildHomework(TENANT_A, PARENT_USER, UNLINKED)).rejects.toThrow(
        NotFoundError,
      );
      await expect(service.getChildCalendar(TENANT_A, PARENT_USER, UNLINKED)).rejects.toThrow(
        NotFoundError,
      );
      await expect(service.getChildNotices(TENANT_A, PARENT_USER, UNLINKED)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('does not leak tenant A academic reads into tenant B even when the parent is linked in A', async () => {
      await linkWithSoleCustody(PARENT_USER, STUDENT_ID);

      await expect(service.getChildAttendance(TENANT_B, PARENT_USER, STUDENT_ID)).rejects.toThrow(
        NotFoundError,
      );
      await expect(service.getChildGrades(TENANT_B, PARENT_USER, STUDENT_ID)).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
