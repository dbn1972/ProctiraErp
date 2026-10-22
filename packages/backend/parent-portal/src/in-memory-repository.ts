/**
 * In-memory parent portal repository (v1 gateway default).
 */
import { ConflictError, type PaginatedResult, type PaginationOptions } from '@proctira/common';

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
  ParentPortalAuditFactory,
  ParentPortalRepository,
} from './parent-portal-repository.js';

function isEffectiveAt(effectiveFrom: Date, effectiveTo: Date | null, at: Date): boolean {
  if (effectiveFrom.getTime() > at.getTime()) return false;
  if (effectiveTo != null && effectiveTo.getTime() <= at.getTime()) return false;
  return true;
}

/** PRC-M536: in-memory offset/limit slice mirroring the Pg COUNT + LIMIT/OFFSET pattern. */
function paginateInMemory<T>(rows: T[], pagination: PaginationOptions): PaginatedResult<T> {
  const totalItems = rows.length;
  const offset = (pagination.page - 1) * pagination.pageSize;
  const data = rows.slice(offset, offset + pagination.pageSize);
  const totalPages = Math.ceil(totalItems / pagination.pageSize) || 1;
  return {
    data,
    meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
  };
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
    // PRC-M533: no-op here — the in-memory store has no transaction to append the audit
    // row inside; only the Pg repository (pg-parent-portal-repository.ts) persists it,
    // mirroring fees-plugin's FeesMoneyAuditSink no-op-when-unbound convention.
    _auditFactory?: ParentPortalAuditFactory<ParentChildLinkEntity>,
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

  async listActiveHouseholdIdsForParent(tenantId: string, parentUserId: string): Promise<string[]> {
    return this.householdMembers
      .filter(
        (row) =>
          row.tenantId === tenantId && row.parentUserId === parentUserId && row.status === 'active',
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
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<MessageThreadEntity>> {
    if (studentIds.length === 0) return paginateInMemory([], pagination);
    const idSet = new Set(studentIds);
    const rows = this.threads
      .filter((thread) => thread.tenantId === tenantId && idSet.has(thread.studentId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return paginateInMemory(rows, pagination);
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

  async listMessagesForThread(
    tenantId: string,
    threadId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<MessageEntity>> {
    const rows = this.messages
      .filter((message) => message.tenantId === tenantId && message.threadId === threadId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return paginateInMemory(rows, pagination);
  }

  async createConsent(
    data: Omit<ConsentEntity, 'createdAt' | 'updatedAt' | 'validTo' | 'decidedAt'> & {
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

  async listConsentsForParent(
    tenantId: string,
    parentUserId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ConsentEntity>> {
    const rows = this.consents
      .filter(
        (consent) =>
          consent.tenantId === tenantId &&
          consent.parentUserId === parentUserId &&
          consent.validTo == null,
      )
      .map((c) => ({ ...c }));
    return paginateInMemory(rows, pagination);
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

  /**
   * PRC-M315: atomic-from-the-caller's-perspective close+insert. Mirrors the Pg
   * method's contract: a missing or already-closed current version, or a
   * concurrent insert that already created an open successor for the chain,
   * throws ConflictError instead of corrupting the chain.
   */
  async appendConsentVersion(
    tenantId: string,
    input: {
      currentId: string;
      successor: Omit<ConsentEntity, 'createdAt' | 'updatedAt' | 'validTo' | 'decidedAt'> & {
        decidedAt?: Date | null;
      };
      closedAt: Date;
    },
    // PRC-M533: no-op here — see createChildLink's comment.
    _auditFactory?: ParentPortalAuditFactory<ConsentEntity>,
  ): Promise<ConsentEntity> {
    const { currentId, successor, closedAt } = input;
    const index = this.consents.findIndex((c) => c.id === currentId && c.tenantId === tenantId);
    if (index === -1 || this.consents[index]!.validTo != null) {
      throw new ConflictError('Consent version was already closed by a concurrent decision');
    }

    // Exclude currentId itself — it is still open at this point (closed below)
    // and is expected to be the chain's open row being superseded.
    const openSuccessor = this.consents.find(
      (c) =>
        c.id !== currentId &&
        c.tenantId === successor.tenantId &&
        c.consentChainId === successor.consentChainId &&
        c.validTo == null,
    );
    if (openSuccessor) {
      throw new ConflictError('A concurrent decision already created the next consent version');
    }

    const prior = this.consents[index]!;
    const closed: ConsentEntity = { ...prior, validTo: closedAt, updatedAt: new Date() };
    this.consents[index] = closed;

    const validFrom = successor.validFrom ?? closedAt;
    const entity: ConsentEntity = {
      ...successor,
      supersedesId: successor.supersedesId ?? null,
      validFrom,
      validTo: null,
      decidedAt: successor.decidedAt ?? null,
      withdrawalReason: successor.withdrawalReason ?? null,
      decidedVia: successor.decidedVia ?? null,
      createdAt: validFrom,
      updatedAt: validFrom,
    };
    this.consents.push(entity);
    return { ...entity };
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
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<FeeInvoiceEntity>> {
    if (studentIds.length === 0) return paginateInMemory([], pagination);
    const idSet = new Set(studentIds);
    const rows = this.invoices.filter(
      (invoice) => invoice.tenantId === tenantId && idSet.has(invoice.studentId),
    );
    return paginateInMemory(rows, pagination);
  }

  async listInvoicesForTenant(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<FeeInvoiceEntity>> {
    const rows = this.invoices.filter((invoice) => invoice.tenantId === tenantId);
    return paginateInMemory(rows, pagination);
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
    // PRC-M533: no-op here — see createChildLink's comment.
    _auditFactory?: ParentPortalAuditFactory<FeeInvoiceEntity>,
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

  async createPayment(
    data: Omit<FeePaymentEntity, 'createdAt'>,
    // PRC-M533: no-op here — see createChildLink's comment.
    _auditFactory?: ParentPortalAuditFactory<FeePaymentEntity>,
  ): Promise<FeePaymentEntity> {
    const entity: FeePaymentEntity = { ...data, createdAt: new Date() };
    this.payments.push(entity);
    return entity;
  }

  async listPaymentsForTenant(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<FeePaymentEntity>> {
    const rows = this.payments.filter((payment) => payment.tenantId === tenantId);
    return paginateInMemory(rows, pagination);
  }

  async createReceipt(data: Omit<FeeReceiptEntity, 'createdAt'>): Promise<FeeReceiptEntity> {
    const entity: FeeReceiptEntity = { ...data, createdAt: new Date() };
    this.receipts.push(entity);
    return entity;
  }

  async listReceiptsForTenant(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<FeeReceiptEntity>> {
    const rows = this.receipts.filter((receipt) => receipt.tenantId === tenantId);
    return paginateInMemory(rows, pagination);
  }

  async listReceiptsForInvoiceIds(
    tenantId: string,
    invoiceIds: string[],
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<FeeReceiptEntity>> {
    if (invoiceIds.length === 0) return paginateInMemory([], pagination);
    const idSet = new Set(invoiceIds);
    const rows = this.receipts.filter(
      (receipt) => receipt.tenantId === tenantId && idSet.has(receipt.invoiceId),
    );
    return paginateInMemory(rows, pagination);
  }

  async findReceiptById(id: string, tenantId: string): Promise<FeeReceiptEntity | null> {
    return (
      this.receipts.find((receipt) => receipt.id === id && receipt.tenantId === tenantId) ?? null
    );
  }
}
