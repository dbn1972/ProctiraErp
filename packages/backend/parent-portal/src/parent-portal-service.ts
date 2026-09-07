/**
 * Parent portal service — child links, messaging, consents, fee sandbox.
 */
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { ParentPortalRepository } from './parent-portal-repository.js';
import type {
  CreateConsentInput,
  CreateInvoiceInput,
  CreateThreadInput,
  DecideConsentInput,
  LinkChildInput,
  PayInvoiceInput,
} from './schemas.js';

export class ParentPortalService {
  constructor(private readonly repository: ParentPortalRepository) {}

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

  async createThread(
    tenantId: string,
    parentUserId: string,
    input: CreateThreadInput,
  ) {
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

  async createConsentRequest(
    tenantId: string,
    actorId: string,
    input: CreateConsentInput,
  ) {
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

  async createInvoice(tenantId: string, actorId: string, input: CreateInvoiceInput) {
    return this.repository.createInvoice({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      title: input.title,
      description: input.description ?? '',
      amountCents: input.amountCents,
      currency: input.currency ?? 'INR',
      status: 'open',
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      createdBy: actorId,
    });
  }

  async listInvoicesForParent(tenantId: string, parentUserId: string) {
    const studentIds = await this.getLinkedStudentIds(tenantId, parentUserId);
    return this.repository.listInvoicesForStudentIds(tenantId, studentIds);
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

    const updatedInvoice = await this.repository.updateInvoice(invoiceId, tenantId, {
      status: 'paid',
    });

    return { invoice: updatedInvoice!, payment };
  }
}
