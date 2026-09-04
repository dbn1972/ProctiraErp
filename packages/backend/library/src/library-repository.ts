/** Library repository ports (P20). */

export interface LibraryTitleEntity {
  id: string;
  tenantId: string;
  institutionId: string | null;
  title: string;
  author: string | null;
  isbn: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryCopyEntity {
  id: string;
  tenantId: string;
  titleId: string;
  barcode: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryLoanEntity {
  id: string;
  tenantId: string;
  copyId: string;
  borrowerId: string;
  borrowerType: string;
  loanedAt: string;
  dueAt: string;
  returnedAt: string | null;
  fineInvoiceId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryRepository {
  listLibraryTitles(tenantId: string): Promise<LibraryTitleEntity[]>;
  getLibraryTitle(tenantId: string, id: string): Promise<LibraryTitleEntity | null>;
  createLibraryTitle(row: LibraryTitleEntity): Promise<LibraryTitleEntity>;
  updateLibraryTitle(tenantId: string, id: string, patch: Partial<LibraryTitleEntity>): Promise<LibraryTitleEntity | null>;
  listLibraryCopys(tenantId: string): Promise<LibraryCopyEntity[]>;
  getLibraryCopy(tenantId: string, id: string): Promise<LibraryCopyEntity | null>;
  createLibraryCopy(row: LibraryCopyEntity): Promise<LibraryCopyEntity>;
  updateLibraryCopy(tenantId: string, id: string, patch: Partial<LibraryCopyEntity>): Promise<LibraryCopyEntity | null>;
  listLibraryLoans(tenantId: string): Promise<LibraryLoanEntity[]>;
  getLibraryLoan(tenantId: string, id: string): Promise<LibraryLoanEntity | null>;
  createLibraryLoan(row: LibraryLoanEntity): Promise<LibraryLoanEntity>;
  updateLibraryLoan(tenantId: string, id: string, patch: Partial<LibraryLoanEntity>): Promise<LibraryLoanEntity | null>;
}
