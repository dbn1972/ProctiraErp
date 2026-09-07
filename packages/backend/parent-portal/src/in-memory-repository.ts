/**
 * In-memory parent portal repository (v1 gateway default).
 */
import type {
  ConsentEntity,
  FeeInvoiceEntity,
  FeePaymentEntity,
  MessageEntity,
  MessageThreadEntity,
  ParentChildLinkEntity,
  ParentPortalRepository,
} from './parent-portal-repository.js';

export class InMemoryParentPortalRepository implements ParentPortalRepository {
  private links: ParentChildLinkEntity[] = [];
  private threads: MessageThreadEntity[] = [];
  private messages: MessageEntity[] = [];
  private consents: ConsentEntity[] = [];
  private invoices: FeeInvoiceEntity[] = [];
  private payments: FeePaymentEntity[] = [];

  async createChildLink(
    data: Omit<ParentChildLinkEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ParentChildLinkEntity> {
    const now = new Date();
    const entity: ParentChildLinkEntity = { ...data, createdAt: now, updatedAt: now };
    this.links.push(entity);
    return entity;
  }

  async listChildLinksForParent(
    tenantId: string,
    parentUserId: string,
  ): Promise<ParentChildLinkEntity[]> {
    return this.links.filter(
      (link) =>
        link.tenantId === tenantId &&
        link.parentUserId === parentUserId &&
        link.status === 'active',
    );
  }

  async listChildLinksForStudent(
    tenantId: string,
    studentId: string,
  ): Promise<ParentChildLinkEntity[]> {
    return this.links.filter(
      (link) => link.tenantId === tenantId && link.studentId === studentId,
    );
  }

  async findChildLink(id: string, tenantId: string): Promise<ParentChildLinkEntity | null> {
    return this.links.find((link) => link.id === id && link.tenantId === tenantId) ?? null;
  }

  async hasActiveLink(
    tenantId: string,
    parentUserId: string,
    studentId: string,
  ): Promise<boolean> {
    return this.links.some(
      (link) =>
        link.tenantId === tenantId &&
        link.parentUserId === parentUserId &&
        link.studentId === studentId &&
        link.status === 'active',
    );
  }

  async createThread(
    data: Omit<MessageThreadEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<MessageThreadEntity> {
    const now = new Date();
    const entity: MessageThreadEntity = { ...data, createdAt: now, updatedAt: now };
    this.threads.push(entity);
    return entity;
  }

  async listThreadsForStudentIds(
    tenantId: string,
    studentIds: string[],
  ): Promise<MessageThreadEntity[]> {
    if (studentIds.length === 0) return [];
    const idSet = new Set(studentIds);
    return this.threads
      .filter((thread) => thread.tenantId === tenantId && idSet.has(thread.studentId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async findThreadById(id: string, tenantId: string): Promise<MessageThreadEntity | null> {
    return this.threads.find((thread) => thread.id === id && thread.tenantId === tenantId) ?? null;
  }

  async createMessage(data: Omit<MessageEntity, 'createdAt'>): Promise<MessageEntity> {
    const entity: MessageEntity = { ...data, createdAt: new Date() };
    this.messages.push(entity);
    const threadIndex = this.threads.findIndex(
      (thread) => thread.id === data.threadId && thread.tenantId === data.tenantId,
    );
    if (threadIndex !== -1) {
      this.threads[threadIndex] = {
        ...this.threads[threadIndex]!,
        updatedAt: entity.createdAt,
      };
    }
    return entity;
  }

  async listMessagesForThread(tenantId: string, threadId: string): Promise<MessageEntity[]> {
    return this.messages
      .filter((message) => message.tenantId === tenantId && message.threadId === threadId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createConsent(
    data: Omit<ConsentEntity, 'createdAt' | 'updatedAt' | 'decidedAt'>,
  ): Promise<ConsentEntity> {
    const now = new Date();
    const entity: ConsentEntity = { ...data, decidedAt: null, createdAt: now, updatedAt: now };
    this.consents.push(entity);
    return entity;
  }

  async listConsentsForParent(
    tenantId: string,
    parentUserId: string,
  ): Promise<ConsentEntity[]> {
    return this.consents.filter(
      (consent) => consent.tenantId === tenantId && consent.parentUserId === parentUserId,
    );
  }

  async findConsentById(id: string, tenantId: string): Promise<ConsentEntity | null> {
    return this.consents.find((consent) => consent.id === id && consent.tenantId === tenantId) ?? null;
  }

  async updateConsent(
    id: string,
    tenantId: string,
    data: Partial<Pick<ConsentEntity, 'status' | 'decidedAt'>>,
  ): Promise<ConsentEntity | null> {
    const index = this.consents.findIndex(
      (consent) => consent.id === id && consent.tenantId === tenantId,
    );
    if (index === -1) return null;
    const updated: ConsentEntity = {
      ...this.consents[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.consents[index] = updated;
    return updated;
  }

  async createInvoice(
    data: Omit<FeeInvoiceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeeInvoiceEntity> {
    const now = new Date();
    const entity: FeeInvoiceEntity = { ...data, createdAt: now, updatedAt: now };
    this.invoices.push(entity);
    return entity;
  }

  async listInvoicesForStudentIds(
    tenantId: string,
    studentIds: string[],
  ): Promise<FeeInvoiceEntity[]> {
    if (studentIds.length === 0) return [];
    const idSet = new Set(studentIds);
    return this.invoices.filter(
      (invoice) => invoice.tenantId === tenantId && idSet.has(invoice.studentId),
    );
  }

  async findInvoiceById(id: string, tenantId: string): Promise<FeeInvoiceEntity | null> {
    return this.invoices.find((invoice) => invoice.id === id && invoice.tenantId === tenantId) ?? null;
  }

  async updateInvoice(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeInvoiceEntity, 'status'>>,
  ): Promise<FeeInvoiceEntity | null> {
    const index = this.invoices.findIndex(
      (invoice) => invoice.id === id && invoice.tenantId === tenantId,
    );
    if (index === -1) return null;
    const updated: FeeInvoiceEntity = {
      ...this.invoices[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.invoices[index] = updated;
    return updated;
  }

  async createPayment(data: Omit<FeePaymentEntity, 'createdAt'>): Promise<FeePaymentEntity> {
    const entity: FeePaymentEntity = { ...data, createdAt: new Date() };
    this.payments.push(entity);
    return entity;
  }
}
