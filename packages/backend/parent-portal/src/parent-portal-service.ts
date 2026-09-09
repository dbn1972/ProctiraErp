/**
 * Parent portal service — child links, messaging, consents, fee sandbox, academic reads.
 */
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import {
  EmptyAcademicVisibilityStore,
  STUDENT_SELF_BINDING_ASSUMPTION,
  UUID_RE,
  type AcademicVisibilityStore,
} from './academic-visibility.js';
import type { ParentPortalRepository } from './parent-portal-repository.js';
import type {
  CreateConsentInput,
  CreateFeePlanInput,
  CreateInvoiceInput,
  CreateThreadInput,
  DecideConsentInput,
  LinkChildInput,
  PayInvoiceInput,
} from './schemas.js';

export { STUDENT_SELF_BINDING_ASSUMPTION };

export interface StudentActor {
  userId: string;
  email?: string | null;
}

function receiptNumberFor(paymentId: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RCP-${stamp}-${paymentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export class ParentPortalService {
  constructor(
    private readonly repository: ParentPortalRepository,
    private readonly academicStore: AcademicVisibilityStore = new EmptyAcademicVisibilityStore(),
  ) {}

  async linkChild(tenantId: string, parentUserId: string, input: LinkChildInput) {
    const existing = await this.repository.hasActiveLink(tenantId, parentUserId, input.studentId);
    if (existing) {
      throw new BusinessRuleError('Parent is already linked to this student');
    }

    return this.repository.createChildLink({
      id: uuidv4(),
      tenantId,
      parentUserId,
      studentId: input.studentId,
      relationship: input.relationship ?? 'guardian',
      status: 'active',
    });
  }

  async listChildrenForParent(tenantId: string, parentUserId: string) {
    return this.repository.listChildLinksForParent(tenantId, parentUserId);
  }

  async listChildrenForStudent(tenantId: string, studentId: string) {
    return this.repository.listChildLinksForStudent(tenantId, studentId);
  }

  private async getLinkedStudentIds(tenantId: string, parentUserId: string): Promise<string[]> {
    const links = await this.repository.listChildLinksForParent(tenantId, parentUserId);
    return links.map((link) => link.studentId);
  }

  private async assertParentLinkedToStudent(
    tenantId: string,
    parentUserId: string,
    studentId: string,
  ): Promise<void> {
    const linked = await this.repository.hasActiveLink(tenantId, parentUserId, studentId);
    if (!linked) {
      throw new NotFoundError(`Student with id '${studentId}' not found`);
    }
  }

  async createThread(tenantId: string, parentUserId: string, input: CreateThreadInput) {
    await this.assertParentLinkedToStudent(tenantId, parentUserId, input.studentId);

    const thread = await this.repository.createThread({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      subject: input.subject,
      createdBy: parentUserId,
      status: 'open',
    });

    const message = await this.repository.createMessage({
      id: uuidv4(),
      threadId: thread.id,
      tenantId,
      senderUserId: parentUserId,
      senderRole: 'parent',
      body: input.body,
    });

    return { thread, message };
  }

  async listThreadsForParent(tenantId: string, parentUserId: string) {
    const studentIds = await this.getLinkedStudentIds(tenantId, parentUserId);
    return this.repository.listThreadsForStudentIds(tenantId, studentIds);
  }

  async addMessage(
    tenantId: string,
    parentUserId: string,
    threadId: string,
    body: string,
    senderRole: 'parent' | 'staff' | 'system' = 'parent',
  ) {
    const thread = await this.repository.findThreadById(threadId, tenantId);
    if (!thread) {
      throw new NotFoundError(`Message thread with id '${threadId}' not found`);
    }

    if (senderRole === 'parent') {
      await this.assertParentLinkedToStudent(tenantId, parentUserId, thread.studentId);
    }

    return this.repository.createMessage({
      id: uuidv4(),
      threadId,
      tenantId,
      senderUserId: parentUserId,
      senderRole,
      body,
    });
  }

  async listMessages(tenantId: string, parentUserId: string, threadId: string) {
    const thread = await this.repository.findThreadById(threadId, tenantId);
    if (!thread) {
      throw new NotFoundError(`Message thread with id '${threadId}' not found`);
    }

    await this.assertParentLinkedToStudent(tenantId, parentUserId, thread.studentId);
    return this.repository.listMessagesForThread(tenantId, threadId);
  }

  async createConsentRequest(tenantId: string, actorId: string, input: CreateConsentInput) {
    return this.repository.createConsent({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      parentUserId: input.parentUserId,
      consentType: input.consentType,
      title: input.title,
      description: input.description ?? '',
      status: 'pending',
      createdBy: actorId,
    });
  }

  async listConsentsForParent(tenantId: string, parentUserId: string) {
    return this.repository.listConsentsForParent(tenantId, parentUserId);
  }

  async decideConsent(
    tenantId: string,
    parentUserId: string,
    consentId: string,
    input: DecideConsentInput,
  ) {
    const consent = await this.repository.findConsentById(consentId, tenantId);
    if (!consent) {
      throw new NotFoundError(`Consent with id '${consentId}' not found`);
    }
    if (consent.parentUserId !== parentUserId) {
      throw new NotFoundError(`Consent with id '${consentId}' not found`);
    }
    if (consent.status !== 'pending') {
      throw new BusinessRuleError('Consent has already been decided');
    }

    const updated = await this.repository.updateConsent(consentId, tenantId, {
      status: input.status,
      decidedAt: new Date(),
    });
    return updated!;
  }

  async createFeePlan(tenantId: string, actorId: string, input: CreateFeePlanInput) {
    const code =
      input.code?.trim() ||
      input.name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32) ||
      'PLAN';

    return this.repository.createFeePlan({
      id: uuidv4(),
      tenantId,
      code,
      name: input.name,
      description: input.description ?? '',
      amountCents: input.amountCents,
      currency: input.currency ?? 'INR',
      frequency: input.frequency ?? 'term',
      status: 'active',
      createdBy: actorId,
    });
  }

  async listFeePlans(tenantId: string) {
    return this.repository.listFeePlans(tenantId);
  }

  async createInvoice(tenantId: string, actorId: string, input: CreateInvoiceInput) {
    let title = input.title;
    let description = input.description ?? '';
    let amountCents = input.amountCents;
    let currency = input.currency ?? 'INR';
    let planId: string | null = input.planId ?? null;

    if (input.planId) {
      const plan = await this.repository.findFeePlanById(input.planId, tenantId);
      if (!plan || plan.status !== 'active') {
        throw new NotFoundError(`Fee plan with id '${input.planId}' not found`);
      }
      planId = plan.id;
      title = input.title ?? plan.name;
      description = input.description ?? plan.description;
      amountCents = input.amountCents ?? plan.amountCents;
      currency = input.currency ?? plan.currency;
    }

    if (title == null || title.trim() === '') {
      throw new BusinessRuleError('Invoice title is required');
    }
    if (amountCents == null || amountCents < 0) {
      throw new BusinessRuleError('Invoice amountCents is required');
    }

    return this.repository.createInvoice({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      planId,
      title,
      description,
      amountCents,
      currency,
      status: 'open',
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      createdBy: actorId,
    });
  }

  async listInvoicesForParent(tenantId: string, parentUserId: string) {
    const studentIds = await this.getLinkedStudentIds(tenantId, parentUserId);
    return this.repository.listInvoicesForStudentIds(tenantId, studentIds);
  }

  async listInvoicesForStaff(tenantId: string) {
    return this.repository.listInvoicesForTenant(tenantId);
  }

  async voidInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.repository.findInvoiceById(invoiceId, tenantId);
    if (!invoice) {
      throw new NotFoundError(`Invoice with id '${invoiceId}' not found`);
    }
    if (invoice.status === 'paid') {
      throw new BusinessRuleError('Cannot void a paid invoice');
    }
    if (invoice.status === 'void') {
      return invoice;
    }
    const updated = await this.repository.updateInvoice(invoiceId, tenantId, { status: 'void' });
    return updated!;
  }

  async listPaymentsForStaff(tenantId: string) {
    return this.repository.listPaymentsForTenant(tenantId);
  }

  async listReceiptsForStaff(tenantId: string) {
    return this.repository.listReceiptsForTenant(tenantId);
  }

  async listReceiptsForParent(tenantId: string, parentUserId: string) {
    const invoices = await this.listInvoicesForParent(tenantId, parentUserId);
    return this.repository.listReceiptsForInvoiceIds(
      tenantId,
      invoices.map((invoice) => invoice.id),
    );
  }

  async getReceipt(tenantId: string, receiptId: string) {
    const receipt = await this.repository.findReceiptById(receiptId, tenantId);
    if (!receipt) {
      throw new NotFoundError(`Receipt with id '${receiptId}' not found`);
    }
    return receipt;
  }

  async payInvoice(
    tenantId: string,
    parentUserId: string,
    invoiceId: string,
    input: PayInvoiceInput = {},
  ) {
    const invoice = await this.repository.findInvoiceById(invoiceId, tenantId);
    if (!invoice) {
      throw new NotFoundError(`Invoice with id '${invoiceId}' not found`);
    }

    await this.assertParentLinkedToStudent(tenantId, parentUserId, invoice.studentId);

    if (invoice.status !== 'open') {
      throw new BusinessRuleError('Invoice is not open for payment');
    }

    const method = input.method ?? 'sandbox';
    const paidAt = new Date();

    const payment = await this.repository.createPayment({
      id: uuidv4(),
      invoiceId: invoice.id,
      tenantId,
      payerUserId: parentUserId,
      amountCents: invoice.amountCents,
      method,
      status: 'succeeded',
      paidAt,
    });

    const receipt = await this.repository.createReceipt({
      id: uuidv4(),
      tenantId,
      paymentId: payment.id,
      invoiceId: invoice.id,
      receiptNumber: receiptNumberFor(payment.id),
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      issuedAt: paidAt,
    });

    const updatedInvoice = await this.repository.updateInvoice(invoiceId, tenantId, {
      status: 'paid',
    });

    return { invoice: updatedInvoice!, payment, receipt };
  }

  async resolveStudentSelfId(tenantId: string, actor: StudentActor): Promise<string> {
    const mapped = await this.academicStore.resolveStudentId(
      tenantId,
      actor.userId,
      actor.email ?? null,
    );
    if (mapped) return mapped;
    if (UUID_RE.test(actor.userId)) return actor.userId;
    throw new NotFoundError('Student record not found for this account');
  }

  async getChildAttendance(tenantId: string, parentUserId: string, studentId: string) {
    await this.assertParentLinkedToStudent(tenantId, parentUserId, studentId);
    return this.academicStore.getAttendance(tenantId, studentId);
  }

  async getChildGrades(tenantId: string, parentUserId: string, studentId: string) {
    await this.assertParentLinkedToStudent(tenantId, parentUserId, studentId);
    return this.academicStore.getGrades(tenantId, studentId);
  }

  async getChildTimetable(tenantId: string, parentUserId: string, studentId: string) {
    await this.assertParentLinkedToStudent(tenantId, parentUserId, studentId);
    return this.academicStore.getTimetable(tenantId, studentId);
  }

  async getChildHomework(tenantId: string, parentUserId: string, studentId: string) {
    await this.assertParentLinkedToStudent(tenantId, parentUserId, studentId);
    return this.academicStore.getHomework(tenantId, studentId);
  }

  async getChildCalendar(tenantId: string, parentUserId: string, studentId: string) {
    await this.assertParentLinkedToStudent(tenantId, parentUserId, studentId);
    return this.academicStore.getCalendar(tenantId, studentId);
  }

  async getChildNotices(tenantId: string, parentUserId: string, studentId: string) {
    await this.assertParentLinkedToStudent(tenantId, parentUserId, studentId);
    return this.academicStore.getNotices(tenantId, studentId, parentUserId);
  }

  async getSelfAttendance(tenantId: string, actor: StudentActor) {
    const studentId = await this.resolveStudentSelfId(tenantId, actor);
    return this.academicStore.getAttendance(tenantId, studentId);
  }

  async getSelfGrades(tenantId: string, actor: StudentActor) {
    const studentId = await this.resolveStudentSelfId(tenantId, actor);
    return this.academicStore.getGrades(tenantId, studentId);
  }

  async getSelfTimetable(tenantId: string, actor: StudentActor) {
    const studentId = await this.resolveStudentSelfId(tenantId, actor);
    return this.academicStore.getTimetable(tenantId, studentId);
  }

  async getSelfHomework(tenantId: string, actor: StudentActor) {
    const studentId = await this.resolveStudentSelfId(tenantId, actor);
    return this.academicStore.getHomework(tenantId, studentId);
  }

  async getSelfCalendar(tenantId: string, actor: StudentActor) {
    const studentId = await this.resolveStudentSelfId(tenantId, actor);
    return this.academicStore.getCalendar(tenantId, studentId);
  }

  async getSelfNotices(tenantId: string, actor: StudentActor) {
    const studentId = await this.resolveStudentSelfId(tenantId, actor);
    return this.academicStore.getNotices(tenantId, studentId, actor.userId);
  }

  async getSelfPalPlan(tenantId: string, actor: StudentActor) {
    const studentId = await this.resolveStudentSelfId(tenantId, actor);
    return this.academicStore.getPalPlan(tenantId, studentId);
  }
}
