/**
 * Library service client — catalog and overdues.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface LibraryItem {
  id: string;
  tenantId: string;
  isbn: string | null;
  title: string;
  author: string | null;
  copies: number;
  available: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryLoan {
  id: string;
  tenantId: string;
  itemId: string;
  patronUserId: string | null;
  studentId: string | null;
  checkoutAt: string;
  dueAt: string;
  returnedAt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLibraryItemInput {
  title: string;
  isbn?: string;
  author?: string;
  copies?: number;
}

export async function listLibraryItems(): Promise<LibraryItem[]> {
  const result = await gatewayFetch<{ data: LibraryItem[] }>('/library/items', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createLibraryItem(input: CreateLibraryItemInput): Promise<LibraryItem> {
  const result = await gatewayFetch<LibraryItem>('/library/items', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create library item',
    });
  }
  return result.data;
}

export async function listLibraryOverdues(): Promise<LibraryLoan[]> {
  const result = await gatewayFetch<{ data: LibraryLoan[] }>('/library/overdues', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}
