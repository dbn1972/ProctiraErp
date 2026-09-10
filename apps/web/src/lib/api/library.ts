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
  barcode?: string | null;
  accessionNo?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryCopy {
  id: string;
  itemId: string;
  barcode: string;
  accessionNo: string | null;
  status: string;
}

export interface LibraryLoan {
  id: string;
  tenantId: string;
  itemId: string;
  copyId?: string | null;
  barcode?: string | null;
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

export async function checkoutLibraryItem(input: {
  itemId: string;
  patronUserId?: string;
  studentId?: string;
  dueAt?: string;
}): Promise<LibraryLoan> {
  const result = await gatewayFetch<LibraryLoan>('/library/circulation/checkout', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CHECKOUT_FAILED',
      message: result.error?.message ?? 'Failed to checkout item',
    });
  }
  return result.data;
}

export async function returnLibraryLoan(loanId: string): Promise<LibraryLoan> {
  const result = await gatewayFetch<LibraryLoan>('/library/circulation/return', {
    method: 'POST',
    json: { loanId },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'RETURN_FAILED',
      message: result.error?.message ?? 'Failed to return loan',
    });
  }
  return result.data;
}

export async function renewLibraryLoan(loanId: string, extendDays?: number): Promise<LibraryLoan> {
  const result = await gatewayFetch<LibraryLoan>('/library/circulation/renew', {
    method: 'POST',
    json: { loanId, extendDays },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'RENEW_FAILED',
      message: result.error?.message ?? 'Failed to renew loan',
    });
  }
  return result.data;
}

export interface LibraryClearance {
  studentId: string;
  clear: boolean;
  openLoanCount: number;
  overdueCount: number;
  openLoans: LibraryLoan[];
  checkedAt: string;
}

export async function getLibraryClearance(studentId: string): Promise<LibraryClearance> {
  const result = await gatewayFetch<LibraryClearance>(
    `/library/patrons/${encodeURIComponent(studentId)}/clearance`,
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CLEARANCE_FAILED',
      message: result.error?.message ?? 'Failed to check library clearance',
    });
  }
  return result.data;
}

export interface LibraryHold {
  id: string;
  tenantId: string;
  itemId: string;
  copyId: string | null;
  patronUserId: string | null;
  studentId: string | null;
  position: number;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryFine {
  id: string;
  loanId: string;
  studentId: string;
  amountCents: number;
  currency: string;
  overdueDays: number;
  status: string;
  invoiceId: string | null;
}

export interface IsbnLookupResult {
  isbn: string;
  title: string;
  author: string | null;
  publisher: string | null;
  publishedYear: number | null;
}

export async function lookupIsbn(isbn: string): Promise<IsbnLookupResult | null> {
  const result = await gatewayFetch<IsbnLookupResult>(`/library/isbn/${encodeURIComponent(isbn)}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ?? null;
}

export async function importLibraryIsbn(isbn: string, copies?: number): Promise<LibraryItem> {
  const result = await gatewayFetch<LibraryItem>('/library/items/import-isbn', {
    method: 'POST',
    json: { isbn, copies },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'IMPORT_FAILED',
      message: result.error?.message ?? 'Failed to import ISBN',
    });
  }
  return result.data;
}

export async function searchLibraryOpac(q: string): Promise<LibraryItem[]> {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const result = await gatewayFetch<{ data: LibraryItem[] }>(`/library/opac/search${query}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listLibraryLoans(opts?: {
  studentId?: string;
  patronUserId?: string;
}): Promise<LibraryLoan[]> {
  const params = new URLSearchParams();
  if (opts?.studentId) params.set('studentId', opts.studentId);
  if (opts?.patronUserId) params.set('patronUserId', opts.patronUserId);
  const suffix = params.size ? `?${params.toString()}` : '';
  const result = await gatewayFetch<{ data: LibraryLoan[] }>(`/library/loans${suffix}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listLibraryHolds(opts?: {
  itemId?: string;
  studentId?: string;
  patronUserId?: string;
}): Promise<LibraryHold[]> {
  const params = new URLSearchParams();
  if (opts?.itemId) params.set('itemId', opts.itemId);
  if (opts?.studentId) params.set('studentId', opts.studentId);
  if (opts?.patronUserId) params.set('patronUserId', opts.patronUserId);
  const suffix = params.size ? `?${params.toString()}` : '';
  const result = await gatewayFetch<{ data: LibraryHold[] }>(`/library/holds${suffix}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function placeLibraryHold(input: {
  itemId: string;
  patronUserId?: string;
  studentId?: string;
}): Promise<LibraryHold> {
  const result = await gatewayFetch<LibraryHold>('/library/holds', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'HOLD_FAILED',
      message: result.error?.message ?? 'Failed to place hold',
    });
  }
  return result.data;
}

export async function checkoutLibraryByBarcode(input: {
  barcode: string;
  patronUserId?: string;
  studentId?: string;
  dueAt?: string;
}): Promise<LibraryLoan> {
  const result = await gatewayFetch<LibraryLoan>('/library/circulation/checkout', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CHECKOUT_FAILED',
      message: result.error?.message ?? 'Failed to checkout by barcode',
    });
  }
  return result.data;
}

export async function returnLibraryByBarcode(barcode: string): Promise<LibraryLoan> {
  const result = await gatewayFetch<LibraryLoan>('/library/circulation/return-barcode', {
    method: 'POST',
    json: { barcode },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'RETURN_FAILED',
      message: result.error?.message ?? 'Failed to return by barcode',
    });
  }
  return result.data;
}

export async function assessLibraryFine(loanId: string): Promise<{
  loanId: string;
  amountCents: number;
  invoice: { id: string; status: string } | null;
}> {
  const result = await gatewayFetch<{
    loanId: string;
    amountCents: number;
    invoice: { id: string; status: string } | null;
  }>('/library/fines/assess', {
    method: 'POST',
    json: { loanId },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'ASSESS_FAILED',
      message: result.error?.message ?? 'Failed to assess fine',
    });
  }
  return result.data;
}

export async function listLibraryFines(studentId?: string): Promise<LibraryFine[]> {
  const query = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
  const result = await gatewayFetch<{ data: LibraryFine[] }>(`/library/fines${query}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export interface LibraryItemDetail extends LibraryItem {
  copyList: LibraryCopy[];
  holds: LibraryHold[];
}

export async function getLibraryItem(id: string): Promise<LibraryItemDetail | null> {
  const result = await gatewayFetch<LibraryItemDetail>(`/library/items/${encodeURIComponent(id)}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (!result.data) return null;
  return {
    ...result.data,
    copyList: result.data.copyList ?? [],
    holds: result.data.holds ?? [],
  };
}

export async function payLibraryFine(id: string): Promise<LibraryFine> {
  const result = await gatewayFetch<LibraryFine>(`/library/fines/${encodeURIComponent(id)}/pay`, {
    method: 'POST',
    json: {},
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'PAY_FAILED',
      message: result.error?.message ?? 'Failed to mark fine paid',
    });
  }
  return result.data;
}
