/**
 * Postgres-backed fees repository (raw `pg` — no Prisma).
 *
 * Persists against parent_fee_* tables from db/sql/010_parent_portal_schema.sql
 * and db/sql/011_fees_finance_schema.sql. Uses withPgTenant for RLS (G-103 / G-201).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';

import type {
  FeeLedgerEntryEntity,
  LedgerAccount,
  LedgerSide,
  LedgerTrialBalance,
  FeeInvoiceEntity,
  FeePaymentEntity,
  FeePlanEntity,
  FeePlanFrequency,
  FeePlanStatus,
  FeeReceiptEntity,
  FeesRepository,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
} from './fees-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedFeesPool(): pg.Pool | null {
  const url = resolveDatabaseUrl();
  if (!url) return null;
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: url });
  }
  return sharedPool;
}

function resolveSqlPath(filename: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, `../../../../db/sql/${filename}`),
    join(process.cwd(), `db/sql/${filename}`),
    join(process.cwd(), `../../db/sql/${filename}`),
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

export async function ensureFeesSchema(pool: PgPoolLike = getSharedFeesPool()!): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for fees schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql010 = readFileSync(resolveSqlPath('010_parent_portal_schema.sql'), 'utf8');
      await pool.query(sql010);
      const sql011 = readFileSync(resolveSqlPath('011_fees_finance_schema.sql'), 'utf8');
      await pool.query(sql011);
      // G-718 double-entry ledger (needs schema_migrations from 021 for its ledger row).
      await pool.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           filename TEXT PRIMARY KEY, checksum TEXT, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      );
      const sql023 = readFileSync(resolveSqlPath('023_fee_ledger_schema.sql'), 'utf8');
      await pool.query(sql023);
    })();
  }
  await schemaReady;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapPlan(row: Record<string, unknown>): FeePlanEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    code: String(row.code),
    name: String(row.name),
    description: String(row.description),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    frequency: String(row.frequency) as FeePlanFrequency,
    status: String(row.status) as FeePlanStatus,
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapInvoice(row: Record<string, unknown>): FeeInvoiceEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    planId: row.plan_id == null ? null : String(row.plan_id),
    title: String(row.title),
    description: String(row.description),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    status: String(row.status) as InvoiceStatus,
    dueAt: row.due_at == null ? null : toDate(row.due_at),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapPayment(row: Record<string, unknown>): FeePaymentEntity {
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    tenantId: String(row.tenant_id),
    payerUserId: String(row.payer_user_id),
    amountCents: Number(row.amount_cents),
    method: String(row.method) as PaymentMethod,
    status: String(row.status) as PaymentStatus,
    paidAt: toDate(row.paid_at),
    createdAt: toDate(row.created_at),
  };
}

function mapReceipt(row: Record<string, unknown>): FeeReceiptEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    paymentId: String(row.payment_id),
    invoiceId: String(row.invoice_id),
    receiptNumber: String(row.receipt_number),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    issuedAt: toDate(row.issued_at),
    createdAt: toDate(row.created_at),
  };
}

function mapLedgerEntry(row: Record<string, unknown>): FeeLedgerEntryEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    journalId: String(row.journal_id),
    invoiceId: String(row.invoice_id),
    paymentId: row.payment_id == null ? null : String(row.payment_id),
    receiptId: row.receipt_id == null ? null : String(row.receipt_id),
    account: String(row.account) as LedgerAccount,
    side: String(row.side) as LedgerSide,
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    memo: row.memo == null ? null : String(row.memo),
    postedBy: row.posted_by == null ? null : String(row.posted_by),
    postedAt: toDate(row.posted_at),
    createdAt: toDate(row.created_at),
  };
}

export class PgFeesRepository implements FeesRepository {
  constructor(
    private readonly pool: PgPoolLike,
    private readonly options: { ensureSchema?: boolean } = {},
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.options.ensureSchema === false) return;
    await ensureFeesSchema(this.pool);
  }

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  // ─── Double-entry ledger (G-718) ──────────────────────────────────────────
  // All legs of a journal are inserted in ONE transaction (withTenant opens
  // BEGIN/COMMIT); the deferred constraint trigger rejects the COMMIT when
  // any journal in the transaction is unbalanced.

  async postLedgerEntries(
    entries: Omit<FeeLedgerEntryEntity, 'createdAt'>[],
  ): Promise<FeeLedgerEntryEntity[]> {
    if (entries.length === 0) return [];
    await this.ensureSchema();
    const tenantId = entries[0]!.tenantId;
    if (entries.some((e) => e.tenantId !== tenantId)) {
      throw new Error('postLedgerEntries: all entries must belong to one tenant');
    }
    return this.withTenant(tenantId, async (client) => {
      const out: FeeLedgerEntryEntity[] = [];
      for (const e of entries) {
        const result = await client.query(
          `INSERT INTO fee_ledger_entries (
             id, tenant_id, journal_id, invoice_id, payment_id, receipt_id,
             account, side, amount_cents, currency, memo, posted_by, posted_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            e.id,
            e.tenantId,
            e.journalId,
            e.invoiceId,
            e.paymentId,
            e.receiptId,
            e.account,
            e.side,
            e.amountCents,
            e.currency,
            e.memo,
            e.postedBy,
            e.postedAt,
          ],
        );
        out.push(mapLedgerEntry(result.rows[0] as Record<string, unknown>));
      }
      return out;
    });
  }

  async listLedgerForInvoice(tenantId: string, invoiceId: string): Promise<FeeLedgerEntryEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_ledger_entries WHERE tenant_id = $1 AND invoice_id = $2
         ORDER BY posted_at ASC, created_at ASC`,
        [tenantId, invoiceId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapLedgerEntry);
    });
  }

  async trialBalance(tenantId: string): Promise<LedgerTrialBalance> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT account,
                COALESCE(SUM(CASE WHEN side = 'debit'  THEN amount_cents END), 0)::bigint AS debit,
                COALESCE(SUM(CASE WHEN side = 'credit' THEN amount_cents END), 0)::bigint AS credit
           FROM fee_ledger_entries WHERE tenant_id = $1 GROUP BY account`,
        [tenantId],
      );
      const accounts: Record<LedgerAccount, number> = {
        accounts_receivable: 0,
        cash: 0,
        fee_revenue: 0,
      };
      let debitCents = 0;
      let creditCents = 0;
      for (const raw of result.rows as {
        account: LedgerAccount;
        debit: string;
        credit: string;
      }[]) {
        const d = Number(raw.debit);
        const c = Number(raw.credit);
        debitCents += d;
        creditCents += c;
        accounts[raw.account] = d - c;
      }
      return { tenantId, debitCents, creditCents, accounts };
    });
  }

  async createFeePlan(
    data: Omit<FeePlanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeePlanEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO parent_fee_plans (
           id, tenant_id, code, name, description, amount_cents, currency, frequency, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.code,
          data.name,
          data.description,
          data.amountCents,
          data.currency,
          data.frequency,
          data.status,
          data.createdBy,
        ],
      );
      return mapPlan(result.rows[0] as Record<string, unknown>);
    });
  }

  async listFeePlans(tenantId: string): Promise<FeePlanEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_plans WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapPlan(row as Record<string, unknown>));
    });
  }

  async findFeePlanById(id: string, tenantId: string): Promise<FeePlanEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_plans WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapPlan(result.rows[0] as Record<string, unknown>);
    });
  }

  async createInvoice(
    data: Omit<FeeInvoiceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeeInvoiceEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO parent_fee_invoices (
           id, tenant_id, student_id, plan_id, title, description, amount_cents, currency, status, due_at, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.planId,
          data.title,
          data.description,
          data.amountCents,
          data.currency,
          data.status,
          data.dueAt,
          data.createdBy,
        ],
      );
      return mapInvoice(result.rows[0] as Record<string, unknown>);
    });
  }

  async listInvoicesForTenant(tenantId: string): Promise<FeeInvoiceEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_invoices WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapInvoice(row as Record<string, unknown>));
    });
  }

  async findInvoiceById(id: string, tenantId: string): Promise<FeeInvoiceEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_invoices WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapInvoice(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateInvoice(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeInvoiceEntity, 'status'>>,
  ): Promise<FeeInvoiceEntity | null> {
    await this.ensureSchema();
    if (data.status === undefined) {
      return this.findInvoiceById(id, tenantId);
    }
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE parent_fee_invoices
         SET status = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3
         RETURNING *`,
        [data.status, id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapInvoice(result.rows[0] as Record<string, unknown>);
    });
  }

  async createPayment(data: Omit<FeePaymentEntity, 'createdAt'>): Promise<FeePaymentEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO parent_fee_payments (
           id, invoice_id, tenant_id, payer_user_id, amount_cents, method, status, paid_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          data.id,
          data.invoiceId,
          data.tenantId,
          data.payerUserId,
          data.amountCents,
          data.method,
          data.status,
          data.paidAt,
        ],
      );
      return mapPayment(result.rows[0] as Record<string, unknown>);
    });
  }

  async listPaymentsForTenant(tenantId: string): Promise<FeePaymentEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_payments WHERE tenant_id = $1 ORDER BY paid_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapPayment(row as Record<string, unknown>));
    });
  }

  async findPaymentById(id: string, tenantId: string): Promise<FeePaymentEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_payments WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapPayment(result.rows[0] as Record<string, unknown>);
    });
  }

  async createReceipt(data: Omit<FeeReceiptEntity, 'createdAt'>): Promise<FeeReceiptEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO parent_fee_receipts (
           id, tenant_id, payment_id, invoice_id, receipt_number, amount_cents, currency, issued_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.paymentId,
          data.invoiceId,
          data.receiptNumber,
          data.amountCents,
          data.currency,
          data.issuedAt,
        ],
      );
      return mapReceipt(result.rows[0] as Record<string, unknown>);
    });
  }

  async listReceiptsForTenant(tenantId: string): Promise<FeeReceiptEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_receipts WHERE tenant_id = $1 ORDER BY issued_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapReceipt(row as Record<string, unknown>));
    });
  }

  async findReceiptById(id: string, tenantId: string): Promise<FeeReceiptEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_receipts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapReceipt(result.rows[0] as Record<string, unknown>);
    });
  }
}

export function createPgFeesRepository(): PgFeesRepository | null {
  const pool = getSharedFeesPool();
  if (!pool) return null;
  return new PgFeesRepository(pool);
}
