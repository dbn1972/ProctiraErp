import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError, NotFoundError } from '@proctira/common';

import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { ParentPortalService } from './parent-portal-service.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-000000000002';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';
const PARENT_USER = 'parent-a';

describe('ParentPortalService', () => {
  let repository: InMemoryParentPortalRepository;
  let service: ParentPortalService;

  beforeEach(() => {
    repository = new InMemoryParentPortalRepository();
    service = new ParentPortalService(repository);
  });

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
      await service.linkChild(TENANT_A, PARENT_USER, { studentId: STUDENT_ID });
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
    it('allows parent to approve a pending consent', async () => {
      const consent = await service.createConsentRequest(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        consentType: 'photo_media',
        title: 'Photo consent',
        description: 'Allow school photos',
      });

      expect(consent.status).toBe('pending');

      await service.linkChild(TENANT_A, PARENT_USER, { studentId: STUDENT_ID });

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
      });

      await expect(
        service.decideConsent(TENANT_A, 'other-parent', consent.id, { status: 'approved' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('fee sandbox pay', () => {
    beforeEach(async () => {
      await service.linkChild(TENANT_A, PARENT_USER, { studentId: STUDENT_ID });
    });

    it('marks invoice paid and records sandbox payment', async () => {
      const invoice = await service.createInvoice(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        title: 'Term 1 tuition',
        amountCents: 2500000,
        currency: 'INR',
      });

      expect(invoice.status).toBe('open');

      const {
        invoice: paidInvoice,
        payment,
        receipt,
      } = await service.payInvoice(TENANT_A, PARENT_USER, invoice.id, { method: 'sandbox' });

      expect(paidInvoice.status).toBe('paid');
      expect(payment.amountCents).toBe(2500000);
      expect(payment.method).toBe('sandbox');
      expect(payment.status).toBe('succeeded');
      expect(payment.payerUserId).toBe(PARENT_USER);
      expect(receipt.paymentId).toBe(payment.id);
      expect(receipt.receiptNumber).toMatch(/^RCP-/);
    });

    it('creates invoice from fee plan and isolates plans across tenants', async () => {
      const plan = await service.createFeePlan(TENANT_A, 'staff-admin', {
        code: 'TERM1',
        name: 'Term 1 tuition plan',
        amountCents: 1500000,
        currency: 'INR',
        frequency: 'term',
      });

      const invoice = await service.createInvoice(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        planId: plan.id,
      });

      expect(invoice.planId).toBe(plan.id);
      expect(invoice.title).toBe('Term 1 tuition plan');
      expect(invoice.amountCents).toBe(1500000);

      expect(await service.listFeePlans(TENANT_B)).toHaveLength(0);
      expect(await service.listInvoicesForStaff(TENANT_B)).toHaveLength(0);
    });

    it('rejects paying an already paid invoice', async () => {
      const invoice = await service.createInvoice(TENANT_A, 'staff-admin', {
        studentId: STUDENT_ID,
        title: 'Lab fee',
        amountCents: 50000,
      });

      await service.payInvoice(TENANT_A, PARENT_USER, invoice.id);

      await expect(service.payInvoice(TENANT_A, PARENT_USER, invoice.id)).rejects.toThrow(
        BusinessRuleError,
      );
    });
  });

  describe('cross-tenant isolation', () => {
    it('does not expose tenant A data when listing from tenant B', async () => {
      await service.linkChild(TENANT_A, PARENT_USER, { studentId: STUDENT_ID });
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
      await service.linkChild(TENANT_A, PARENT_USER, { studentId: STUDENT_ID });
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
});
