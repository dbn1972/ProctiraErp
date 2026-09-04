import { randomUUID } from 'node:crypto';
import type {
  LibraryTitleEntity,
  LibraryCopyEntity,
  LibraryLoanEntity,
  LibraryRepository,
} from './library-repository.js';

export class LibraryService {
  constructor(private readonly repo: LibraryRepository) {}

  listLibraryTitles(tenantId: string) {
    return this.repo.listLibraryTitles(tenantId);
  }
  getLibraryTitle(tenantId: string, id: string) {
    return this.repo.getLibraryTitle(tenantId, id);
  }
  createLibraryTitle(
    tenantId: string,
    input: Omit<LibraryTitleEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createLibraryTitle({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as LibraryTitleEntity);
  }
  updateLibraryTitle(tenantId: string, id: string, patch: Partial<LibraryTitleEntity>) {
    return this.repo.updateLibraryTitle(tenantId, id, patch);
  }
  listLibraryCopys(tenantId: string) {
    return this.repo.listLibraryCopys(tenantId);
  }
  getLibraryCopy(tenantId: string, id: string) {
    return this.repo.getLibraryCopy(tenantId, id);
  }
  createLibraryCopy(
    tenantId: string,
    input: Omit<LibraryCopyEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createLibraryCopy({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as LibraryCopyEntity);
  }
  updateLibraryCopy(tenantId: string, id: string, patch: Partial<LibraryCopyEntity>) {
    return this.repo.updateLibraryCopy(tenantId, id, patch);
  }
  listLibraryLoans(tenantId: string) {
    return this.repo.listLibraryLoans(tenantId);
  }
  getLibraryLoan(tenantId: string, id: string) {
    return this.repo.getLibraryLoan(tenantId, id);
  }
  createLibraryLoan(
    tenantId: string,
    input: Omit<LibraryLoanEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createLibraryLoan({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as LibraryLoanEntity);
  }
  updateLibraryLoan(tenantId: string, id: string, patch: Partial<LibraryLoanEntity>) {
    return this.repo.updateLibraryLoan(tenantId, id, patch);
  }
}
