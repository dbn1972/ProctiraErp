import type { PrismaClient } from '@proctira/database';
import type {
  LibraryTitleEntity,
  LibraryCopyEntity,
  LibraryLoanEntity,
  LibraryRepository,
} from './library-repository.js';

function iso(v: Date | string) {
  return v instanceof Date ? v.toISOString() : v;
}

export class PrismaLibraryRepository implements LibraryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listLibraryTitles(tenantId: string) {
    const rows = await (this.prisma as any).libraryTitle.findMany({ where: { tenantId } });
    return rows.map(mapLibraryTitle);
  }
  async getLibraryTitle(tenantId: string, id: string) {
    const row = await (this.prisma as any).libraryTitle.findFirst({ where: { id, tenantId } });
    return row ? mapLibraryTitle(row) : null;
  }
  async createLibraryTitle(row: LibraryTitleEntity) {
    const created = await (this.prisma as any).libraryTitle.create({ data: toLibraryTitle(row) });
    return mapLibraryTitle(created);
  }
  async updateLibraryTitle(tenantId: string, id: string, patch: Partial<LibraryTitleEntity>) {
    const existing = await this.getLibraryTitle(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).libraryTitle.update({
      where: { id },
      data: toLibraryTitle({ ...existing, ...patch, id, tenantId }),
    });
    return mapLibraryTitle(updated);
  }
  async listLibraryCopys(tenantId: string) {
    const rows = await (this.prisma as any).libraryCopy.findMany({ where: { tenantId } });
    return rows.map(mapLibraryCopy);
  }
  async getLibraryCopy(tenantId: string, id: string) {
    const row = await (this.prisma as any).libraryCopy.findFirst({ where: { id, tenantId } });
    return row ? mapLibraryCopy(row) : null;
  }
  async createLibraryCopy(row: LibraryCopyEntity) {
    const created = await (this.prisma as any).libraryCopy.create({ data: toLibraryCopy(row) });
    return mapLibraryCopy(created);
  }
  async updateLibraryCopy(tenantId: string, id: string, patch: Partial<LibraryCopyEntity>) {
    const existing = await this.getLibraryCopy(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).libraryCopy.update({
      where: { id },
      data: toLibraryCopy({ ...existing, ...patch, id, tenantId }),
    });
    return mapLibraryCopy(updated);
  }
  async listLibraryLoans(tenantId: string) {
    const rows = await (this.prisma as any).libraryLoan.findMany({ where: { tenantId } });
    return rows.map(mapLibraryLoan);
  }
  async getLibraryLoan(tenantId: string, id: string) {
    const row = await (this.prisma as any).libraryLoan.findFirst({ where: { id, tenantId } });
    return row ? mapLibraryLoan(row) : null;
  }
  async createLibraryLoan(row: LibraryLoanEntity) {
    const created = await (this.prisma as any).libraryLoan.create({ data: toLibraryLoan(row) });
    return mapLibraryLoan(created);
  }
  async updateLibraryLoan(tenantId: string, id: string, patch: Partial<LibraryLoanEntity>) {
    const existing = await this.getLibraryLoan(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).libraryLoan.update({
      where: { id },
      data: toLibraryLoan({ ...existing, ...patch, id, tenantId }),
    });
    return mapLibraryLoan(updated);
  }
}

function mapLibraryTitle(row: any): LibraryTitleEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId ?? null,
    title: row.title,
    author: row.author ?? null,
    isbn: row.isbn ?? null,
    category: row.category ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toLibraryTitle(row: LibraryTitleEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId ?? null,
    title: row.title,
    author: row.author ?? null,
    isbn: row.isbn ?? null,
    category: row.category ?? null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapLibraryCopy(row: any): LibraryCopyEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    titleId: row.titleId,
    barcode: row.barcode,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toLibraryCopy(row: LibraryCopyEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    titleId: row.titleId,
    barcode: row.barcode,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapLibraryLoan(row: any): LibraryLoanEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    copyId: row.copyId,
    borrowerId: row.borrowerId,
    borrowerType: row.borrowerType,
    loanedAt: row.loanedAt,
    dueAt: row.dueAt,
    returnedAt: row.returnedAt ?? null,
    fineInvoiceId: row.fineInvoiceId ?? null,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toLibraryLoan(row: LibraryLoanEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    copyId: row.copyId,
    borrowerId: row.borrowerId,
    borrowerType: row.borrowerType,
    loanedAt: row.loanedAt,
    dueAt: row.dueAt,
    returnedAt: row.returnedAt ?? null,
    fineInvoiceId: row.fineInvoiceId ?? null,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
