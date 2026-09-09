/**
 * In-memory library repository (v1 gateway default).
 */
import type {
  LibraryCopyEntity,
  LibraryFineEntity,
  LibraryFinePolicyEntity,
  LibraryHoldEntity,
  LibraryItemEntity,
  LibraryLoanEntity,
  LibraryRepository,
  NewCopy,
  NewFine,
  NewFinePolicy,
  NewHold,
  NewItem,
  NewLoan,
} from './library-repository.js';

export class InMemoryLibraryRepository implements LibraryRepository {
  private items: LibraryItemEntity[] = [];
  private loans: LibraryLoanEntity[] = [];
  private copies: LibraryCopyEntity[] = [];
  private holds: LibraryHoldEntity[] = [];
  private policies: LibraryFinePolicyEntity[] = [];
  private fines: LibraryFineEntity[] = [];

  async createItem(data: NewItem): Promise<LibraryItemEntity> {
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

  async searchItems(tenantId: string, query: string): Promise<LibraryItemEntity[]> {
    const q = query.trim().toLowerCase();
    if (!q) return this.listItems(tenantId);
    return this.items.filter((i) => {
      if (i.tenantId !== tenantId) return false;
      return (
        i.title.toLowerCase().includes(q) ||
        (i.author ?? '').toLowerCase().includes(q) ||
        (i.isbn ?? '').toLowerCase().includes(q) ||
        (i.barcode ?? '').toLowerCase().includes(q)
      );
    });
  }

  async updateItem(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryItemEntity, 'available' | 'copies'>>,
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

  async createLoan(data: NewLoan): Promise<LibraryLoanEntity> {
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
    data: Partial<Pick<LibraryLoanEntity, 'returnedAt' | 'status' | 'dueAt'>>,
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

  async createCopy(data: NewCopy): Promise<LibraryCopyEntity> {
    const now = new Date();
    const entity: LibraryCopyEntity = { ...data, createdAt: now, updatedAt: now };
    this.copies.push(entity);
    return entity;
  }

  async listCopies(tenantId: string, itemId?: string): Promise<LibraryCopyEntity[]> {
    return this.copies.filter(
      (c) => c.tenantId === tenantId && (itemId === undefined || c.itemId === itemId),
    );
  }

  async findCopyById(id: string, tenantId: string): Promise<LibraryCopyEntity | null> {
    return this.copies.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }

  async findCopyByBarcode(tenantId: string, barcode: string): Promise<LibraryCopyEntity | null> {
    const needle = barcode.trim();
    return this.copies.find((c) => c.tenantId === tenantId && c.barcode === needle) ?? null;
  }

  async updateCopy(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryCopyEntity, 'status'>>,
  ): Promise<LibraryCopyEntity | null> {
    const index = this.copies.findIndex((c) => c.id === id && c.tenantId === tenantId);
    if (index === -1) return null;
    const updated: LibraryCopyEntity = {
      ...this.copies[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.copies[index] = updated;
    return updated;
  }

  async createHold(data: NewHold): Promise<LibraryHoldEntity> {
    const now = new Date();
    const entity: LibraryHoldEntity = { ...data, createdAt: now, updatedAt: now };
    this.holds.push(entity);
    return entity;
  }

  async listHolds(tenantId: string, itemId?: string): Promise<LibraryHoldEntity[]> {
    return this.holds.filter(
      (h) => h.tenantId === tenantId && (itemId === undefined || h.itemId === itemId),
    );
  }

  async findHoldById(id: string, tenantId: string): Promise<LibraryHoldEntity | null> {
    return this.holds.find((h) => h.id === id && h.tenantId === tenantId) ?? null;
  }

  async updateHold(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryHoldEntity, 'status' | 'position' | 'copyId' | 'expiresAt'>>,
  ): Promise<LibraryHoldEntity | null> {
    const index = this.holds.findIndex((h) => h.id === id && h.tenantId === tenantId);
    if (index === -1) return null;
    const updated: LibraryHoldEntity = {
      ...this.holds[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.holds[index] = updated;
    return updated;
  }

  async getFinePolicy(tenantId: string): Promise<LibraryFinePolicyEntity | null> {
    return this.policies.find((p) => p.tenantId === tenantId) ?? null;
  }

  async upsertFinePolicy(data: NewFinePolicy): Promise<LibraryFinePolicyEntity> {
    const index = this.policies.findIndex((p) => p.tenantId === data.tenantId);
    const now = new Date();
    if (index === -1) {
      const entity: LibraryFinePolicyEntity = { ...data, createdAt: now, updatedAt: now };
      this.policies.push(entity);
      return entity;
    }
    const updated: LibraryFinePolicyEntity = {
      ...this.policies[index]!,
      ...data,
      updatedAt: now,
    };
    this.policies[index] = updated;
    return updated;
  }

  async createFine(data: NewFine): Promise<LibraryFineEntity> {
    const now = new Date();
    const entity: LibraryFineEntity = { ...data, createdAt: now, updatedAt: now };
    this.fines.push(entity);
    return entity;
  }

  async listFines(tenantId: string, studentId?: string): Promise<LibraryFineEntity[]> {
    return this.fines.filter(
      (f) => f.tenantId === tenantId && (studentId === undefined || f.studentId === studentId),
    );
  }

  async findFineById(id: string, tenantId: string): Promise<LibraryFineEntity | null> {
    return this.fines.find((f) => f.id === id && f.tenantId === tenantId) ?? null;
  }

  async findOpenFineForLoan(tenantId: string, loanId: string): Promise<LibraryFineEntity | null> {
    return (
      this.fines.find(
        (f) => f.tenantId === tenantId && f.loanId === loanId && f.status === 'open',
      ) ?? null
    );
  }

  async updateFine(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryFineEntity, 'status' | 'paidAt' | 'invoiceId'>>,
  ): Promise<LibraryFineEntity | null> {
    const index = this.fines.findIndex((f) => f.id === id && f.tenantId === tenantId);
    if (index === -1) return null;
    const updated: LibraryFineEntity = {
      ...this.fines[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.fines[index] = updated;
    return updated;
  }
}
