/**
 * Postgres-backed library repository (raw `pg` — no Prisma).
 *
 * Catalog/loans: db/sql/009_library_schema.sql
 * Copies/holds/fines: db/sql/039_library_ops_schema.sql
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant } from '@proctira/database';
import pg from 'pg';

import type {
  CopyStatus,
  FineStatus,
  HoldStatus,
  LibraryCopyEntity,
  LibraryFineEntity,
  LibraryFinePolicyEntity,
  LibraryHoldEntity,
  LibraryItemEntity,
  LibraryLoanEntity,
  LibraryRepository,
  LoanStatus,
  NewCopy,
  NewFine,
  NewFinePolicy,
  NewHold,
  NewItem,
  NewLoan,
} from './library-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedLibraryPool(): pg.Pool | null {
  const url = resolveDatabaseUrl();
  if (!url) return null;
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: url });
  }
  return sharedPool;
}

function resolveSqlFile(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, `../../../../db/sql/${name}`),
    join(process.cwd(), `db/sql/${name}`),
    join(process.cwd(), `../../db/sql/${name}`),
  ];
  for (const path of candidates) {
    try {
      readFileSync(path, 'utf8');
      return path;
    } catch {
      // try next
    }
  }
  return candidates[0]!;
}

export async function ensureLibrarySchema(
  pool: PgPoolLike = getSharedLibraryPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for library schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(readFileSync(resolveSqlFile('009_library_schema.sql'), 'utf8'));
      await pool.query(readFileSync(resolveSqlFile('039_library_ops_schema.sql'), 'utf8'));
    })();
  }
  await schemaReady;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  return toDate(value);
}

function mapItem(row: Record<string, unknown>): LibraryItemEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    isbn: row.isbn == null ? null : String(row.isbn),
    title: String(row.title),
    author: row.author == null ? null : String(row.author),
    copies: Number(row.copies),
    available: Number(row.available),
    barcode: row.barcode == null ? null : String(row.barcode),
    accessionNo: row.accession_no == null ? null : String(row.accession_no),
    publisher: row.publisher == null ? null : String(row.publisher),
    publishedYear: row.published_year == null ? null : Number(row.published_year),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapLoan(row: Record<string, unknown>): LibraryLoanEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    itemId: String(row.item_id),
    copyId: row.copy_id == null ? null : String(row.copy_id),
    barcode: row.barcode == null ? null : String(row.barcode),
    patronUserId: row.patron_user_id == null ? null : String(row.patron_user_id),
    studentId: row.student_id == null ? null : String(row.student_id),
    checkoutAt: toDate(row.checkout_at),
    dueAt: toDate(row.due_at),
    returnedAt: toDateOrNull(row.returned_at),
    status: String(row.status) as LoanStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapCopy(row: Record<string, unknown>): LibraryCopyEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    itemId: String(row.item_id),
    barcode: String(row.barcode),
    accessionNo: row.accession_no == null ? null : String(row.accession_no),
    status: String(row.status) as CopyStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapHold(row: Record<string, unknown>): LibraryHoldEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    itemId: String(row.item_id),
    copyId: row.copy_id == null ? null : String(row.copy_id),
    patronUserId: row.patron_user_id == null ? null : String(row.patron_user_id),
    studentId: row.student_id == null ? null : String(row.student_id),
    position: Number(row.position),
    status: String(row.status) as HoldStatus,
    expiresAt: toDateOrNull(row.expires_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapPolicy(row: Record<string, unknown>): LibraryFinePolicyEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    centsPerDay: Number(row.cents_per_day),
    capCents: Number(row.cap_cents),
    currency: String(row.currency),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapFine(row: Record<string, unknown>): LibraryFineEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    loanId: String(row.loan_id),
    studentId: String(row.student_id),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    overdueDays: Number(row.overdue_days),
    status: String(row.status) as FineStatus,
    invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
    paidAt: toDateOrNull(row.paid_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgLibraryRepository implements LibraryRepository {
  constructor(private readonly pool: PgPoolLike) {}

  /** G-710: every query runs with the tenant GUC bound so RLS applies. */
  private query(tenantId: string, text: string, values?: unknown[]): Promise<pg.QueryResult> {
    return withPgTenant(
      this.pool,
      tenantId,
      (client) => client.query(text, values) as unknown as Promise<pg.QueryResult>,
    );
  }

  async ensureSchema(): Promise<void> {
    await ensureLibrarySchema(this.pool);
  }

  async createItem(data: NewItem): Promise<LibraryItemEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO library_items (
         id, tenant_id, isbn, title, author, copies, available,
         barcode, accession_no, publisher, published_year
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.isbn,
        data.title,
        data.author,
        data.copies,
        data.available,
        data.barcode,
        data.accessionNo,
        data.publisher,
        data.publishedYear,
      ],
    );
    return mapItem(result.rows[0] as Record<string, unknown>);
  }

  async listItems(tenantId: string): Promise<LibraryItemEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_items WHERE tenant_id = $1 ORDER BY title`,
      [tenantId],
    );
    return result.rows.map((row) => mapItem(row as Record<string, unknown>));
  }

  async findItemById(id: string, tenantId: string): Promise<LibraryItemEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_items WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapItem(result.rows[0] as Record<string, unknown>);
  }

  async searchItems(tenantId: string, query: string): Promise<LibraryItemEntity[]> {
    await this.ensureSchema();
    const q = query.trim();
    if (!q) return this.listItems(tenantId);
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_items
       WHERE tenant_id = $1
         AND (
           title ILIKE $2 OR COALESCE(author, '') ILIKE $2
           OR COALESCE(isbn, '') ILIKE $2 OR COALESCE(barcode, '') ILIKE $2
         )
       ORDER BY title`,
      [tenantId, `%${q}%`],
    );
    return result.rows.map((row) => mapItem(row as Record<string, unknown>));
  }

  async updateItem(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryItemEntity, 'available' | 'copies'>>,
  ): Promise<LibraryItemEntity | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.available !== undefined) {
      sets.push(`available = $${i++}`);
      values.push(data.available);
    }
    if (data.copies !== undefined) {
      sets.push(`copies = $${i++}`);
      values.push(data.copies);
    }
    if (sets.length === 0) return this.findItemById(id, tenantId);
    sets.push(`updated_at = now()`);
    values.push(id, tenantId);
    const result = await this.query(
      tenantId,
      `UPDATE library_items SET ${sets.join(', ')}
       WHERE id = $${i++} AND tenant_id = $${i}
       RETURNING *`,
      values,
    );
    if (!result.rows[0]) return null;
    return mapItem(result.rows[0] as Record<string, unknown>);
  }

  async createLoan(data: NewLoan): Promise<LibraryLoanEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO library_loans (
         id, tenant_id, item_id, copy_id, barcode, patron_user_id, student_id,
         checkout_at, due_at, returned_at, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.itemId,
        data.copyId,
        data.barcode,
        data.patronUserId,
        data.studentId,
        data.checkoutAt,
        data.dueAt,
        data.returnedAt,
        data.status,
      ],
    );
    return mapLoan(result.rows[0] as Record<string, unknown>);
  }

  async findLoanById(id: string, tenantId: string): Promise<LibraryLoanEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_loans WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapLoan(result.rows[0] as Record<string, unknown>);
  }

  async updateLoan(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryLoanEntity, 'returnedAt' | 'status' | 'dueAt'>>,
  ): Promise<LibraryLoanEntity | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (data.returnedAt !== undefined) {
      sets.push(`returned_at = $${i++}`);
      values.push(data.returnedAt);
    }
    if (data.status !== undefined) {
      sets.push(`status = $${i++}`);
      values.push(data.status);
    }
    if (data.dueAt !== undefined) {
      sets.push(`due_at = $${i++}`);
      values.push(data.dueAt);
    }

    if (sets.length === 0) {
      return this.findLoanById(id, tenantId);
    }

    sets.push(`updated_at = now()`);
    values.push(id, tenantId);

    const result = await this.query(
      tenantId,
      `UPDATE library_loans
       SET ${sets.join(', ')}
       WHERE id = $${i++} AND tenant_id = $${i}
       RETURNING *`,
      values,
    );
    if (!result.rows[0]) return null;
    return mapLoan(result.rows[0] as Record<string, unknown>);
  }

  async listLoans(tenantId: string): Promise<LibraryLoanEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_loans WHERE tenant_id = $1 ORDER BY checkout_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapLoan(row as Record<string, unknown>));
  }

  async createCopy(data: NewCopy): Promise<LibraryCopyEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO library_copies (id, tenant_id, item_id, barcode, accession_no, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.id, data.tenantId, data.itemId, data.barcode, data.accessionNo, data.status],
    );
    return mapCopy(result.rows[0] as Record<string, unknown>);
  }

  async listCopies(tenantId: string, itemId?: string): Promise<LibraryCopyEntity[]> {
    await this.ensureSchema();
    if (itemId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM library_copies WHERE tenant_id = $1 AND item_id = $2 ORDER BY accession_no, barcode`,
        [tenantId, itemId],
      );
      return result.rows.map((row) => mapCopy(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_copies WHERE tenant_id = $1 ORDER BY barcode`,
      [tenantId],
    );
    return result.rows.map((row) => mapCopy(row as Record<string, unknown>));
  }

  async findCopyById(id: string, tenantId: string): Promise<LibraryCopyEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_copies WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapCopy(result.rows[0] as Record<string, unknown>);
  }

  async findCopyByBarcode(tenantId: string, barcode: string): Promise<LibraryCopyEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_copies WHERE tenant_id = $1 AND barcode = $2 LIMIT 1`,
      [tenantId, barcode.trim()],
    );
    if (!result.rows[0]) return null;
    return mapCopy(result.rows[0] as Record<string, unknown>);
  }

  async updateCopy(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryCopyEntity, 'status'>>,
  ): Promise<LibraryCopyEntity | null> {
    await this.ensureSchema();
    if (data.status === undefined) return this.findCopyById(id, tenantId);
    const result = await this.query(
      tenantId,
      `UPDATE library_copies SET status = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [data.status, id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapCopy(result.rows[0] as Record<string, unknown>);
  }

  async createHold(data: NewHold): Promise<LibraryHoldEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO library_holds (
         id, tenant_id, item_id, copy_id, patron_user_id, student_id,
         position, status, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.itemId,
        data.copyId,
        data.patronUserId,
        data.studentId,
        data.position,
        data.status,
        data.expiresAt,
      ],
    );
    return mapHold(result.rows[0] as Record<string, unknown>);
  }

  async listHolds(tenantId: string, itemId?: string): Promise<LibraryHoldEntity[]> {
    await this.ensureSchema();
    if (itemId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM library_holds WHERE tenant_id = $1 AND item_id = $2
         ORDER BY position, created_at`,
        [tenantId, itemId],
      );
      return result.rows.map((row) => mapHold(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_holds WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );
    return result.rows.map((row) => mapHold(row as Record<string, unknown>));
  }

  async findHoldById(id: string, tenantId: string): Promise<LibraryHoldEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_holds WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapHold(result.rows[0] as Record<string, unknown>);
  }

  async updateHold(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryHoldEntity, 'status' | 'position' | 'copyId' | 'expiresAt'>>,
  ): Promise<LibraryHoldEntity | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.status !== undefined) {
      sets.push(`status = $${i++}`);
      values.push(data.status);
    }
    if (data.position !== undefined) {
      sets.push(`position = $${i++}`);
      values.push(data.position);
    }
    if (data.copyId !== undefined) {
      sets.push(`copy_id = $${i++}`);
      values.push(data.copyId);
    }
    if (data.expiresAt !== undefined) {
      sets.push(`expires_at = $${i++}`);
      values.push(data.expiresAt);
    }
    if (sets.length === 0) return this.findHoldById(id, tenantId);
    sets.push(`updated_at = now()`);
    values.push(id, tenantId);
    const result = await this.query(
      tenantId,
      `UPDATE library_holds SET ${sets.join(', ')}
       WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
      values,
    );
    if (!result.rows[0]) return null;
    return mapHold(result.rows[0] as Record<string, unknown>);
  }

  async getFinePolicy(tenantId: string): Promise<LibraryFinePolicyEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_fine_policies WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    if (!result.rows[0]) return null;
    return mapPolicy(result.rows[0] as Record<string, unknown>);
  }

  async upsertFinePolicy(data: NewFinePolicy): Promise<LibraryFinePolicyEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO library_fine_policies (id, tenant_id, cents_per_day, cap_cents, currency)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id) DO UPDATE
         SET cents_per_day = EXCLUDED.cents_per_day,
             cap_cents = EXCLUDED.cap_cents,
             currency = EXCLUDED.currency,
             updated_at = now()
       RETURNING *`,
      [data.id, data.tenantId, data.centsPerDay, data.capCents, data.currency],
    );
    return mapPolicy(result.rows[0] as Record<string, unknown>);
  }

  async createFine(data: NewFine): Promise<LibraryFineEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO library_fines (
         id, tenant_id, loan_id, student_id, amount_cents, currency,
         overdue_days, status, invoice_id, paid_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.loanId,
        data.studentId,
        data.amountCents,
        data.currency,
        data.overdueDays,
        data.status,
        data.invoiceId,
        data.paidAt,
      ],
    );
    return mapFine(result.rows[0] as Record<string, unknown>);
  }

  async listFines(tenantId: string, studentId?: string): Promise<LibraryFineEntity[]> {
    await this.ensureSchema();
    if (studentId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM library_fines WHERE tenant_id = $1 AND student_id = $2
         ORDER BY created_at DESC`,
        [tenantId, studentId],
      );
      return result.rows.map((row) => mapFine(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_fines WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapFine(row as Record<string, unknown>));
  }

  async findFineById(id: string, tenantId: string): Promise<LibraryFineEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_fines WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapFine(result.rows[0] as Record<string, unknown>);
  }

  async findOpenFineForLoan(tenantId: string, loanId: string): Promise<LibraryFineEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM library_fines
       WHERE tenant_id = $1 AND loan_id = $2 AND status = 'open' LIMIT 1`,
      [tenantId, loanId],
    );
    if (!result.rows[0]) return null;
    return mapFine(result.rows[0] as Record<string, unknown>);
  }

  async updateFine(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryFineEntity, 'status' | 'paidAt' | 'invoiceId'>>,
  ): Promise<LibraryFineEntity | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.status !== undefined) {
      sets.push(`status = $${i++}`);
      values.push(data.status);
    }
    if (data.paidAt !== undefined) {
      sets.push(`paid_at = $${i++}`);
      values.push(data.paidAt);
    }
    if (data.invoiceId !== undefined) {
      sets.push(`invoice_id = $${i++}`);
      values.push(data.invoiceId);
    }
    if (sets.length === 0) return this.findFineById(id, tenantId);
    sets.push(`updated_at = now()`);
    values.push(id, tenantId);
    const result = await this.query(
      tenantId,
      `UPDATE library_fines SET ${sets.join(', ')}
       WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
      values,
    );
    if (!result.rows[0]) return null;
    return mapFine(result.rows[0] as Record<string, unknown>);
  }
}

export function createPgLibraryRepository(): PgLibraryRepository | null {
  const pool = getSharedLibraryPool();
  if (!pool) return null;
  return new PgLibraryRepository(pool);
}
