import type {
  LibraryTitleEntity,
  LibraryCopyEntity,
  LibraryLoanEntity,
  LibraryRepository,
} from './library-repository.js';

export class InMemoryLibraryRepository implements LibraryRepository {
  private readonly libraryTitles = new Map<string, LibraryTitleEntity>();
  private readonly libraryCopys = new Map<string, LibraryCopyEntity>();
  private readonly libraryLoans = new Map<string, LibraryLoanEntity>();

  async listLibraryTitles(tenantId: string) {
    return [...this.libraryTitles.values()].filter((x) => x.tenantId === tenantId);
  }
  async getLibraryTitle(tenantId: string, id: string) {
    const row = this.libraryTitles.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createLibraryTitle(row: LibraryTitleEntity) {
    this.libraryTitles.set(row.id, row);
    return row;
  }
  async updateLibraryTitle(tenantId: string, id: string, patch: Partial<LibraryTitleEntity>) {
    const cur = await this.getLibraryTitle(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.libraryTitles.set(id, next);
    return next;
  }
  async listLibraryCopys(tenantId: string) {
    return [...this.libraryCopys.values()].filter((x) => x.tenantId === tenantId);
  }
  async getLibraryCopy(tenantId: string, id: string) {
    const row = this.libraryCopys.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createLibraryCopy(row: LibraryCopyEntity) {
    this.libraryCopys.set(row.id, row);
    return row;
  }
  async updateLibraryCopy(tenantId: string, id: string, patch: Partial<LibraryCopyEntity>) {
    const cur = await this.getLibraryCopy(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.libraryCopys.set(id, next);
    return next;
  }
  async listLibraryLoans(tenantId: string) {
    return [...this.libraryLoans.values()].filter((x) => x.tenantId === tenantId);
  }
  async getLibraryLoan(tenantId: string, id: string) {
    const row = this.libraryLoans.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createLibraryLoan(row: LibraryLoanEntity) {
    this.libraryLoans.set(row.id, row);
    return row;
  }
  async updateLibraryLoan(tenantId: string, id: string, patch: Partial<LibraryLoanEntity>) {
    const cur = await this.getLibraryLoan(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.libraryLoans.set(id, next);
    return next;
  }
}
