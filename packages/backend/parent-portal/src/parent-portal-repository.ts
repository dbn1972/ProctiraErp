/**
 * Parent portal repository interface (in-memory v1 / Postgres).
 */

export type LinkStatus = 'active' | 'pending' | 'revoked';
export type LinkRelationship = 'guardian' | 'mother' | 'father' | 'other';
export type ThreadStatus = 'open' | 'closed';
export type SenderRole = 'parent' | 'staff' | 'system';
export type ConsentType =
  | 'photo_media'
  | 'medical_treatment'
  | 'field_trip'
  | 'data_sharing'
  | 'other';
export type ConsentStatus = 'pending' | 'approved' | 'denied' | 'revoked';
export type InvoiceStatus = 'open' | 'paid' | 'void' | 'overdue';
export type PaymentMethod = 'sandbox' | 'upi' | 'card' | 'cash';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed';

export interface ParentChildLinkEntity {
  id: string;
  tenantId: string;
  parentUserId: string;
  studentId: string;
  relationship: LinkRelationship;
  status: LinkStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageThreadEntity {
  id: string;
  tenantId: string;
  studentId: string;
  subject: string;
  createdBy: string;
  status: ThreadStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageEntity {
  id: string;
  threadId: string;
  tenantId: string;
  senderUserId: string;
  senderRole: SenderRole;
  body: string;
  createdAt: Date;
}

export interface ConsentEntity {
  id: string;
  tenantId: string;
  studentId: string;
  parentUserId: string;
  consentType: ConsentType;
  title: string;
  description: string;
  status: ConsentStatus;
  decidedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeeInvoiceEntity {
  id: string;
  tenantId: string;
  studentId: string;
  title: string;
  description: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  dueAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeePaymentEntity {
  id: string;
  invoiceId: string;
  tenantId: string;
  payerUserId: string;
  amountCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date;
  createdAt: Date;
}

export interface ParentPortalRepository {
  createChildLink(
    data: Omit<ParentChildLinkEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ParentChildLinkEntity>;
  listChildLinksForParent(
    tenantId: string,
    parentUserId: string,
  ): Promise<ParentChildLinkEntity[]>;
  listChildLinksForStudent(
    tenantId: string,
    studentId: string,
  ): Promise<ParentChildLinkEntity[]>;
  findChildLink(id: string, tenantId: string): Promise<ParentChildLinkEntity | null>;
  hasActiveLink(
    tenantId: string,
    parentUserId: string,
    studentId: string,
  ): Promise<boolean>;

  createThread(
    data: Omit<MessageThreadEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<MessageThreadEntity>;
  listThreadsForStudentIds(
    tenantId: string,
    studentIds: string[],
  ): Promise<MessageThreadEntity[]>;
  findThreadById(id: string, tenantId: string): Promise<MessageThreadEntity | null>;

  createMessage(data: Omit<MessageEntity, 'createdAt'>): Promise<MessageEntity>;
  listMessagesForThread(tenantId: string, threadId: string): Promise<MessageEntity[]>;

  createConsent(
    data: Omit<ConsentEntity, 'createdAt' | 'updatedAt' | 'decidedAt'>,
  ): Promise<ConsentEntity>;
  listConsentsForParent(
    tenantId: string,
    parentUserId: string,
  ): Promise<ConsentEntity[]>;
  findConsentById(id: string, tenantId: string): Promise<ConsentEntity | null>;
  updateConsent(
    id: string,
    tenantId: string,
    data: Partial<Pick<ConsentEntity, 'status' | 'decidedAt'>>,
  ): Promise<ConsentEntity | null>;

  createInvoice(
    data: Omit<FeeInvoiceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeeInvoiceEntity>;
  listInvoicesForStudentIds(
    tenantId: string,
    studentIds: string[],
  ): Promise<FeeInvoiceEntity[]>;
  findInvoiceById(id: string, tenantId: string): Promise<FeeInvoiceEntity | null>;
  updateInvoice(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeInvoiceEntity, 'status'>>,
  ): Promise<FeeInvoiceEntity | null>;

  createPayment(data: Omit<FeePaymentEntity, 'createdAt'>): Promise<FeePaymentEntity>;
}
