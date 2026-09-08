/**
 * Postgres-backed library repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, catalog/loans persist via db/sql/009_library_schema.sql.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant } from '@proctira/database';
import pg from 'pg';

import type {
  LibraryItemEntity,
  LibraryLoanEntity,
  LibraryRepository,
  LoanStatus,
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

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/009_library_schema.sql'),
    join(process.cwd(), 'db/sql/009_library_schema.sql'),
    join(process.cwd(), '../../db/sql/009_library_schema.sql'),
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
      const sql = readFileSync(schemaSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await schemaReady;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
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
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapLoan(row: Record<string, unknown>): LibraryLoanEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    itemId: String(row.item_id),
    patronUserId: row.patron_user_id == null ? null : String(row.patron_user_id),
    studentId: row.student_id == null ? null : String(row.student_id),
    checkoutAt: toDate(row.checkout_at),
    dueAt: toDate(row.due_at),
    returnedAt: row.returned_at == null ? null : toDate(row.returned_at),
    status: String(row.status) as LoanStatus,
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

  async createItem(
    data: Omit<LibraryItemEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<LibraryItemEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO library_items (id, tenant_id, isbn, title, author, copies, available)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [data.id, data.tenantId, data.isbn, data.title, data.author, data.copies, data.available],
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

  async updateItem(
    id: string,
    tenantId: string,
    data: Partial<Pick<LibraryItemEntity, 'available'>>,
  ): Promise<LibraryItemEntity | null> {
    await this.ensureSchema();
    if (data.available === undefined) {
      return this.findItemById(id, tenantId);
    }
    const result = await this.query(
      tenantId,
      `UPDATE library_items
       SET available = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [data.available, id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapItem(result.rows[0] as Record<string, unknown>);
  }

  async createLoan(
    data: Omit<LibraryLoanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<LibraryLoanEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO library_loans (
         id, tenant_id, item_id, patron_user_id, student_id,
         checkout_at, due_at, returned_at, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.itemId,
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
}

export function createPgLibraryRepository(): PgLibraryRepository | null {
  const pool = getSharedLibraryPool();
  if (!pool) return null;
  return new PgLibraryRepository(pool);
}
