/**
 * In-memory library repository (v1 gateway default).
 */
import type {
  LibraryItemEntity,
  LibraryLoanEntity,
  LibraryRepository,
} from './library-repository.js';

export class InMemoryLibraryRepository implements LibraryRepository {
  private items: LibraryItemEntity[] = [];
  private loans: LibraryLoanEntity[] = [];

  async createItem(
    data: Omit<LibraryItemEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<LibraryItemEntity> {
    const now = new Date();
    const entity: LibraryItemEntity = { ...data, createdAt: now, updatedAt: now };
    this.items.push(entity);
    return entity;
  }

  async listItems(tenantId: string): Promise<LibraryItemEntity[]> {
    return this.items.filter((i) => i.tenantId === tenantId);
  }

  async findItemById(id: string, tenantId: string): Promise<LibraryItemEntity | null> {
    return this.items.find((i) => i.id === id && i.tenantId === tenantId) ?? null;
  }

  async updateItem(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryItemEntity, 'available'>>,
  ): Promise<LibraryItemEntity | null> {
    const index = this.items.findIndex((i) => i.id === id && i.tenantId === tenantId);
    if (index === -1) return null;
    const updated: LibraryItemEntity = {
      ...this.items[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.items[index] = updated;
    return updated;
  }

  async createLoan(
    data: Omit<LibraryLoanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<LibraryLoanEntity> {
    const now = new Date();
    const entity: LibraryLoanEntity = { ...data, createdAt: now, updatedAt: now };
    this.loans.push(entity);
    return entity;
  }

  async findLoanById(id: string, tenantId: string): Promise<LibraryLoanEntity | null> {
    return this.loans.find((l) => l.id === id && l.tenantId === tenantId) ?? null;
  }

  async updateLoan(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryLoanEntity, 'returnedAt' | 'status'>>,
  ): Promise<LibraryLoanEntity | null> {
    const index = this.loans.findIndex((l) => l.id === id && l.tenantId === tenantId);
    if (index === -1) return null;
    const updated: LibraryLoanEntity = {
      ...this.loans[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.loans[index] = updated;
    return updated;
  }

  async listLoans(tenantId: string): Promise<LibraryLoanEntity[]> {
    return this.loans.filter((l) => l.tenantId === tenantId);
  }
}
