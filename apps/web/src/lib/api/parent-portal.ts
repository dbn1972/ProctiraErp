/**
 * Parent portal service client.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface ParentChildLink {
  id: string;
  tenantId: string;
  parentUserId: string;
  studentId: string;
  relationship: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LinkChildInput {
  parentUserId?: string;
  studentId: string;
  relationship?: 'guardian' | 'mother' | 'father' | 'other';
}

export interface MessageThread {
  id: string;
  tenantId: string;
  studentId: string;
  subject: string;
  createdBy: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  tenantId: string;
  senderUserId: string;
  senderRole: string;
  body: string;
  createdAt: string;
}

export interface CreateThreadInput {
  studentId: string;
  subject: string;
  body: string;
}

export interface ConsentRequest {
  id: string;
  tenantId: string;
  studentId: string;
  parentUserId: string;
  consentType: string;
  title: string;
  description: string;
  status: string;
  decidedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeeInvoice {
  id: string;
  tenantId: string;
  studentId: string;
  title: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  dueAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeePayment {
  id: string;
  invoiceId: string;
  tenantId: string;
  payerUserId: string;
  amountCents: number;
  method: string;
  status: string;
  paidAt: string;
  createdAt: string;
}

export async function listChildren(): Promise<ParentChildLink[]> {
  const result = await gatewayFetch<{ data: ParentChildLink[] }>('/parent-portal/children', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function linkChild(input: LinkChildInput): Promise<ParentChildLink> {
  const result = await gatewayFetch<ParentChildLink>('/parent-portal/children/links', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'LINK_FAILED',
      message: result.error?.message ?? 'Failed to link child',
    });
  }
  return result.data;
}

export async function listThreads(): Promise<MessageThread[]> {
  const result = await gatewayFetch<{ data: MessageThread[] }>('/parent-portal/messages/threads', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createThread(
  input: CreateThreadInput,
): Promise<{ thread: MessageThread; message: Message }> {
  const result = await gatewayFetch<{ thread: MessageThread; message: Message }>(
    '/parent-portal/messages/threads',
    {
      method: 'POST',
      json: input,
    },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create thread',
    });
  }
  return result.data;
}

export async function listMessages(threadId: string): Promise<Message[]> {
  const result = await gatewayFetch<{ data: Message[] }>(
    `/parent-portal/messages/threads/${threadId}/messages`,
    {
      throwOnError: false,
      next: { revalidate: 0 },
    },
  );
  return result.data?.data ?? [];
}

export async function replyToThread(threadId: string, body: string): Promise<Message> {
  const result = await gatewayFetch<Message>(
    `/parent-portal/messages/threads/${threadId}/messages`,
    {
      method: 'POST',
      json: { body },
    },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'REPLY_FAILED',
      message: result.error?.message ?? 'Failed to send reply',
    });
  }
  return result.data;
}

export async function listConsents(): Promise<ConsentRequest[]> {
  const result = await gatewayFetch<{ data: ConsentRequest[] }>('/parent-portal/consents', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function decideConsent(
  id: string,
  status: 'approved' | 'denied',
): Promise<ConsentRequest> {
  const result = await gatewayFetch<ConsentRequest>(`/parent-portal/consents/${id}/decide`, {
    method: 'POST',
    json: { status },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'DECIDE_FAILED',
      message: result.error?.message ?? 'Failed to decide consent',
    });
  }
  return result.data;
}

export async function listInvoices(): Promise<FeeInvoice[]> {
  const result = await gatewayFetch<{ data: FeeInvoice[] }>('/parent-portal/fees/invoices', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function payInvoice(
  id: string,
  method: 'sandbox' | 'upi' | 'card' | 'cash' = 'sandbox',
): Promise<{ invoice: FeeInvoice; payment: FeePayment }> {
  const result = await gatewayFetch<{ invoice: FeeInvoice; payment: FeePayment }>(
    `/parent-portal/fees/invoices/${id}/pay`,
    {
      method: 'POST',
      json: { method },
    },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'PAY_FAILED',
      message: result.error?.message ?? 'Failed to pay invoice',
    });
  }
  return result.data;
}
