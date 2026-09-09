/**
 * Library repository interface (catalog, copies, holds, fines).
 */

export type LoanStatus = 'checked_out' | 'returned' | 'overdue';
export type CopyStatus = 'available' | 'on_loan' | 'reserved';
export type HoldStatus = 'queued' | 'ready' | 'fulfilled' | 'expired' | 'cancelled';
export type FineStatus = 'open' | 'paid' | 'waived';

export interface LibraryItemEntity {
  id: string;
  tenantId: string;
  isbn: string | null;
  title: string;
  author: string | null;
  copies: number;
  available: number;
  barcode: string | null;
  accessionNo: string | null;
  publisher: string | null;
  publishedYear: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryLoanEntity {
  id: string;
  tenantId: string;
  itemId: string;
  copyId: string | null;
  barcode: string | null;
  patronUserId: string | null;
  studentId: string | null;
  checkoutAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  status: LoanStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryCopyEntity {
  id: string;
  tenantId: string;
  itemId: string;
  barcode: string;
  accessionNo: string | null;
  status: CopyStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryHoldEntity {
  id: string;
  tenantId: string;
  itemId: string;
  copyId: string | null;
  patronUserId: string | null;
  studentId: string | null;
  position: number;
  status: HoldStatus;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryFinePolicyEntity {
  id: string;
  tenantId: string;
  centsPerDay: number;
  capCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryFineEntity {
  id: string;
  tenantId: string;
  loanId: string;
  studentId: string;
  amountCents: number;
  currency: string;
  overdueDays: number;
  status: FineStatus;
  invoiceId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewItem = Omit<LibraryItemEntity, 'createdAt' | 'updatedAt'>;
export type NewLoan = Omit<LibraryLoanEntity, 'createdAt' | 'updatedAt'>;
export type NewCopy = Omit<LibraryCopyEntity, 'createdAt' | 'updatedAt'>;
export type NewHold = Omit<LibraryHoldEntity, 'createdAt' | 'updatedAt'>;
export type NewFinePolicy = Omit<LibraryFinePolicyEntity, 'createdAt' | 'updatedAt'>;
export type NewFine = Omit<LibraryFineEntity, 'createdAt' | 'updatedAt'>;

export interface LibraryRepository {
  createItem(data: NewItem): Promise<LibraryItemEntity>;
  listItems(tenantId: string): Promise<LibraryItemEntity[]>;
  findItemById(id: string, tenantId: string): Promise<LibraryItemEntity | null>;
  searchItems(tenantId: string, query: string): Promise<LibraryItemEntity[]>;
  updateItem(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryItemEntity, 'available' | 'copies'>>,
  ): Promise<LibraryItemEntity | null>;

  createLoan(data: NewLoan): Promise<LibraryLoanEntity>;
  findLoanById(id: string, tenantId: string): Promise<LibraryLoanEntity | null>;
  updateLoan(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryLoanEntity, 'returnedAt' | 'status' | 'dueAt'>>,
  ): Promise<LibraryLoanEntity | null>;
  listLoans(tenantId: string): Promise<LibraryLoanEntity[]>;

  createCopy(data: NewCopy): Promise<LibraryCopyEntity>;
  listCopies(tenantId: string, itemId?: string): Promise<LibraryCopyEntity[]>;
  findCopyById(id: string, tenantId: string): Promise<LibraryCopyEntity | null>;
  findCopyByBarcode(tenantId: string, barcode: string): Promise<LibraryCopyEntity | null>;
  updateCopy(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryCopyEntity, 'status'>>,
  ): Promise<LibraryCopyEntity | null>;

  createHold(data: NewHold): Promise<LibraryHoldEntity>;
  listHolds(tenantId: string, itemId?: string): Promise<LibraryHoldEntity[]>;
  findHoldById(id: string, tenantId: string): Promise<LibraryHoldEntity | null>;
  updateHold(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryHoldEntity, 'status' | 'position' | 'copyId' | 'expiresAt'>>,
  ): Promise<LibraryHoldEntity | null>;

  getFinePolicy(tenantId: string): Promise<LibraryFinePolicyEntity | null>;
  upsertFinePolicy(data: NewFinePolicy): Promise<LibraryFinePolicyEntity>;
  createFine(data: NewFine): Promise<LibraryFineEntity>;
  listFines(tenantId: string, studentId?: string): Promise<LibraryFineEntity[]>;
  findFineById(id: string, tenantId: string): Promise<LibraryFineEntity | null>;
  findOpenFineForLoan(tenantId: string, loanId: string): Promise<LibraryFineEntity | null>;
  updateFine(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryFineEntity, 'status' | 'paidAt' | 'invoiceId'>>,
  ): Promise<LibraryFineEntity | null>;
}
