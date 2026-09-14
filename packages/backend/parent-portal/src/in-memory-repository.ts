/**
 * In-memory parent portal repository (v1 gateway default).
 */
import type {
  ConsentEntity,
  FeeInvoiceEntity,
  FeePaymentEntity,
  FeePlanEntity,
  FeeReceiptEntity,
  GuardianCustodyRestrictionEntity,
  GuardianHouseholdEntity,
  GuardianHouseholdMemberEntity,
  GuardianStudentCustodyEntity,
  MessageEntity,
  MessageThreadEntity,
  ParentChildLinkEntity,
  ParentPortalRepository,
} from './parent-portal-repository.js';

function isEffectiveAt(
  effectiveFrom: Date,
  effectiveTo: Date | null,
  at: Date,
): boolean {
  if (effectiveFrom.getTime() > at.getTime()) return false;
  if (effectiveTo != null && effectiveTo.getTime() <= at.getTime()) return false;
  return true;
}

export class InMemoryParentPortalRepository implements ParentPortalRepository {
  private links: ParentChildLinkEntity[] = [];
  private households: GuardianHouseholdEntity[] = [];
  private householdMembers: GuardianHouseholdMemberEntity[] = [];
  private studentCustody: GuardianStudentCustodyEntity[] = [];
  private custodyRestrictions: GuardianCustodyRestrictionEntity[] = [];
  private threads: MessageThreadEntity[] = [];
  private messages: MessageEntity[] = [];
  private consents: ConsentEntity[] = [];
  private plans: FeePlanEntity[] = [];
  private invoices: FeeInvoiceEntity[] = [];
  private payments: FeePaymentEntity[] = [];
  private receipts: FeeReceiptEntity[] = [];

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
    return this.links.filter((link) => link.tenantId === tenantId && link.studentId === studentId);
  }

  async findChildLink(id: string, tenantId: string): Promise<ParentChildLinkEntity | null> {
    return this.links.find((link) => link.id === id && link.tenantId === tenantId) ?? null;
  }

  async findActiveLink(
    tenantId: string,
    parentUserId: string,
    studentId: string,
  ): Promise<ParentChildLinkEntity | null> {
    return (
      this.links.find(
        (link) =>
          link.tenantId === tenantId &&
          link.parentUserId === parentUserId &&
          link.studentId === studentId &&
          link.status === 'active',
      ) ?? null
    );
  }

  async hasActiveLink(tenantId: string, parentUserId: string, studentId: string): Promise<boolean> {
    return (await this.findActiveLink(tenantId, parentUserId, studentId)) != null;
  }

  async createHousehold(
    data: Omit<GuardianHouseholdEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<GuardianHouseholdEntity> {
    const now = new Date();
    const entity: GuardianHouseholdEntity = { ...data, createdAt: now, updatedAt: now };
    this.households.push(entity);
    return entity;
  }

  async addHouseholdMember(
    data: Omit<GuardianHouseholdMemberEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<GuardianHouseholdMemberEntity> {
    const now = new Date();
    const entity: GuardianHouseholdMemberEntity = { ...data, createdAt: now, updatedAt: now };
    this.householdMembers.push(entity);
    return entity;
  }

  async assignStudentCustody(
    data: Omit<GuardianStudentCustodyEntity, 'createdAt' | 'updatedAt' | 'effectiveTo'>,
  ): Promise<GuardianStudentCustodyEntity> {
    const now = new Date();
    const entity: GuardianStudentCustodyEntity = {
      ...data,
      effectiveTo: null,
      createdAt: now,
      updatedAt: now,
    };
    this.studentCustody.push(entity);
    return entity;
  }

  async createCustodyRestriction(
    data: Omit<GuardianCustodyRestrictionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<GuardianCustodyRestrictionEntity> {
    const now = new Date();
    const entity: GuardianCustodyRestrictionEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.custodyRestrictions.push(entity);
    return entity;
  }

  async listActiveCustodyHouseholdIdsForStudent(
    tenantId: string,
    studentId: string,
    at: Date = new Date(),
  ): Promise<string[]> {
    return this.studentCustody
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.studentId === studentId &&
          row.status === 'active' &&
          row.custodyType !== 'none' &&
          isEffectiveAt(row.effectiveFrom, row.effectiveTo, at),
      )
      .map((row) => row.householdId);
  }

  async listActiveHouseholdIdsForParent(
    tenantId: string,
    parentUserId: string,
  ): Promise<string[]> {
    return this.householdMembers
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.parentUserId === parentUserId &&
          row.status === 'active',
      )
      .map((row) => row.householdId);
  }

  async listActiveCustodyRestrictions(
    tenantId: string,
    parentUserId: string,
    studentId: string,
    at: Date = new Date(),
  ): Promise<GuardianCustodyRestrictionEntity[]> {
    return this.custodyRestrictions.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.parentUserId === parentUserId &&
        row.studentId === studentId &&
        row.status === 'active' &&
        isEffectiveAt(row.effectiveFrom, row.effectiveTo, at),
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
    data: Omit<ConsentEntity, 'createdAt' | 'updatedAt' | 'validTo'> & {
      decidedAt?: Date | null;
    },
  ): Promise<ConsentEntity> {
    const now = data.validFrom ?? new Date();
    const entity: ConsentEntity = {
      ...data,
      consentChainId: data.consentChainId,
      version: data.version,
      supersedesId: data.supersedesId ?? null,
      validFrom: now,
      validTo: null,
      decidedAt: data.decidedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    // Refuse overlapping open versions for the same chain (mirrors SQL unique index).
    const open = this.consents.find(
      (c) =>
        c.tenantId === entity.tenantId &&
        c.consentChainId === entity.consentChainId &&
        c.validTo == null,
    );
    if (open) {
      throw new Error(
        `parent_consents open version already exists for chain ${entity.consentChainId}`,
      );
    }
    this.consents.push(entity);
    return { ...entity };
  }

  async listConsentsForParent(tenantId: string, parentUserId: string): Promise<ConsentEntity[]> {
    return this.consents
      .filter(
        (consent) =>
          consent.tenantId === tenantId &&
          consent.parentUserId === parentUserId &&
          consent.validTo == null,
      )
      .map((c) => ({ ...c }));
  }

  async findConsentById(id: string, tenantId: string): Promise<ConsentEntity | null> {
    const row =
      this.consents.find((consent) => consent.id === id && consent.tenantId === tenantId) ?? null;
    return row ? { ...row } : null;
  }

  async listConsentVersions(tenantId: string, consentChainId: string): Promise<ConsentEntity[]> {
    return this.consents
      .filter((c) => c.tenantId === tenantId && c.consentChainId === consentChainId)
      .sort((a, b) => a.version - b.version)
      .map((c) => ({ ...c }));
  }

  async closeConsentValidTo(
    tenantId: string,
    id: string,
    validTo: Date,
  ): Promise<ConsentEntity | null> {
    const index = this.consents.findIndex((c) => c.id === id && c.tenantId === tenantId);
    if (index === -1) return null;
    const prior = this.consents[index]!;
    if (prior.validTo != null && validTo > prior.validTo) {
      throw new Error('parent_consents valid_to can only narrow');
    }
    if (validTo < prior.validFrom) {
      throw new Error('parent_consents valid_to must be on or after valid_from');
    }
    const updated: ConsentEntity = {
      ...prior,
      validTo,
      updatedAt: new Date(),
    };
    this.consents[index] = updated;
    return { ...updated };
  }

  async createFeePlan(
    data: Omit<FeePlanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeePlanEntity> {
    const now = new Date();
    const entity: FeePlanEntity = { ...data, createdAt: now, updatedAt: now };
    this.plans.push(entity);
    return entity;
  }

  async listFeePlans(tenantId: string): Promise<FeePlanEntity[]> {
    return this.plans.filter((plan) => plan.tenantId === tenantId);
  }

  async findFeePlanById(id: string, tenantId: string): Promise<FeePlanEntity | null> {
    return this.plans.find((plan) => plan.id === id && plan.tenantId === tenantId) ?? null;
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

  async listInvoicesForTenant(tenantId: string): Promise<FeeInvoiceEntity[]> {
    return this.invoices.filter((invoice) => invoice.tenantId === tenantId);
  }

  async findInvoiceById(id: string, tenantId: string): Promise<FeeInvoiceEntity | null> {
    return (
      this.invoices.find((invoice) => invoice.id === id && invoice.tenantId === tenantId) ?? null
    );
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

  async listPaymentsForTenant(tenantId: string): Promise<FeePaymentEntity[]> {
    return this.payments.filter((payment) => payment.tenantId === tenantId);
  }

  async createReceipt(data: Omit<FeeReceiptEntity, 'createdAt'>): Promise<FeeReceiptEntity> {
    const entity: FeeReceiptEntity = { ...data, createdAt: new Date() };
    this.receipts.push(entity);
    return entity;
  }

  async listReceiptsForTenant(tenantId: string): Promise<FeeReceiptEntity[]> {
    return this.receipts.filter((receipt) => receipt.tenantId === tenantId);
  }

  async listReceiptsForInvoiceIds(
    tenantId: string,
    invoiceIds: string[],
  ): Promise<FeeReceiptEntity[]> {
    if (invoiceIds.length === 0) return [];
    const idSet = new Set(invoiceIds);
    return this.receipts.filter(
      (receipt) => receipt.tenantId === tenantId && idSet.has(receipt.invoiceId),
    );
  }

  async findReceiptById(id: string, tenantId: string): Promise<FeeReceiptEntity | null> {
    return (
      this.receipts.find((receipt) => receipt.id === id && receipt.tenantId === tenantId) ?? null
    );
  }
}
