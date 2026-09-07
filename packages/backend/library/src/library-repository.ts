/**
 * Library repository interface (in-memory v1).
 */

export type LoanStatus = 'checked_out' | 'returned' | 'overdue';

export interface LibraryItemEntity {
  id: string;
  tenantId: string;
  isbn: string | null;
  title: string;
  author: string | null;
  copies: number;
  available: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryLoanEntity {
  id: string;
  tenantId: string;
  itemId: string;
  patronUserId: string | null;
  studentId: string | null;
  checkoutAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  status: LoanStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryRepository {
  createItem(data: Omit<LibraryItemEntity, 'createdAt' | 'updatedAt'>): Promise<LibraryItemEntity>;
  listItems(tenantId: string): Promise<LibraryItemEntity[]>;
  findItemById(id: string, tenantId: string): Promise<LibraryItemEntity | null>;
  updateItem(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryItemEntity, 'available'>>,
  ): Promise<LibraryItemEntity | null>;

  createLoan(data: Omit<LibraryLoanEntity, 'createdAt' | 'updatedAt'>): Promise<LibraryLoanEntity>;
  findLoanById(id: string, tenantId: string): Promise<LibraryLoanEntity | null>;
  updateLoan(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryLoanEntity, 'returnedAt' | 'status' | 'dueAt'>>,
  ): Promise<LibraryLoanEntity | null>;
  listLoans(tenantId: string): Promise<LibraryLoanEntity[]>;
}
