/**
 * Postgres-backed parent portal repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, data persists via db/sql/010_parent_portal_schema.sql
 * and db/sql/011_fees_finance_schema.sql.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant } from '@proctira/database';
import pg from 'pg';

import type {
  ConsentEntity,
  ConsentStatus,
  ConsentType,
  FeeInvoiceEntity,
  FeePaymentEntity,
  FeePlanEntity,
  FeePlanFrequency,
  FeePlanStatus,
  FeeReceiptEntity,
  InvoiceStatus,
  LinkRelationship,
  LinkStatus,
  MessageEntity,
  MessageThreadEntity,
  ParentChildLinkEntity,
  ParentPortalRepository,
  PaymentMethod,
  PaymentStatus,
  SenderRole,
  ThreadStatus,
} from './parent-portal-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;
let seedReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedParentPortalPool(): pg.Pool | null {
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

export async function ensureParentPortalSchema(
  pool: PgPoolLike = getSharedParentPortalPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for parent portal schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql010 = readFileSync(resolveSqlPath('010_parent_portal_schema.sql'), 'utf8');
      await pool.query(sql010);
      const sql011 = readFileSync(resolveSqlPath('011_fees_finance_schema.sql'), 'utf8');
      await pool.query(sql011);
    })();
  }
  await schemaReady;
}

export async function ensureParentPortalSeed(
  pool: PgPoolLike = getSharedParentPortalPool()!,
): Promise<void> {
  if (!pool) return;
  await ensureParentPortalSchema(pool);
  if (
    process.env.PARENT_PORTAL_APPLY_SEED !== '1' &&
    process.env.PARENT_PORTAL_APPLY_SEED !== 'true'
  ) {
    return;
  }
  if (!seedReady) {
    seedReady = (async () => {
      const sql = readFileSync(resolveSqlPath('010b_parent_portal_seed.sql'), 'utf8');
      await pool.query(sql);
    })();
  }
  await seedReady;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapLink(row: Record<string, unknown>): ParentChildLinkEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    parentUserId: String(row.parent_user_id),
    studentId: String(row.student_id),
    relationship: String(row.relationship) as LinkRelationship,
    status: String(row.status) as LinkStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapThread(row: Record<string, unknown>): MessageThreadEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    subject: String(row.subject),
    createdBy: String(row.created_by),
    status: String(row.status) as ThreadStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): MessageEntity {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    tenantId: String(row.tenant_id),
    senderUserId: String(row.sender_user_id),
    senderRole: String(row.sender_role) as SenderRole,
    body: String(row.body),
    createdAt: toDate(row.created_at),
  };
}

function mapConsent(row: Record<string, unknown>): ConsentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    parentUserId: String(row.parent_user_id),
    consentType: String(row.consent_type) as ConsentType,
    title: String(row.title),
    description: String(row.description),
    status: String(row.status) as ConsentStatus,
    decidedAt: row.decided_at == null ? null : toDate(row.decided_at),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
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

export class PgParentPortalRepository implements ParentPortalRepository {
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
    await ensureParentPortalSchema(this.pool);
    await ensureParentPortalSeed(this.pool);
  }

  async createChildLink(
    data: Omit<ParentChildLinkEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ParentChildLinkEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO parent_child_links (
         id, tenant_id, parent_user_id, student_id, relationship, status
       ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.id, data.tenantId, data.parentUserId, data.studentId, data.relationship, data.status],
    );
    return mapLink(result.rows[0] as Record<string, unknown>);
  }

  async listChildLinksForParent(
    tenantId: string,
    parentUserId: string,
  ): Promise<ParentChildLinkEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_child_links
       WHERE tenant_id = $1 AND parent_user_id = $2 AND status = 'active'
       ORDER BY created_at DESC`,
      [tenantId, parentUserId],
    );
    return result.rows.map((row) => mapLink(row as Record<string, unknown>));
  }

  async listChildLinksForStudent(
    tenantId: string,
    studentId: string,
  ): Promise<ParentChildLinkEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_child_links
       WHERE tenant_id = $1 AND student_id = $2
       ORDER BY created_at DESC`,
      [tenantId, studentId],
    );
    return result.rows.map((row) => mapLink(row as Record<string, unknown>));
  }

  async findChildLink(id: string, tenantId: string): Promise<ParentChildLinkEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_child_links WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapLink(result.rows[0] as Record<string, unknown>);
  }

  async hasActiveLink(tenantId: string, parentUserId: string, studentId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT 1 FROM parent_child_links
       WHERE tenant_id = $1 AND parent_user_id = $2 AND student_id = $3 AND status = 'active'
       LIMIT 1`,
      [tenantId, parentUserId, studentId],
    );
    return result.rows.length > 0;
  }

  async createThread(
    data: Omit<MessageThreadEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<MessageThreadEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO parent_message_threads (
         id, tenant_id, student_id, subject, created_by, status
       ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.id, data.tenantId, data.studentId, data.subject, data.createdBy, data.status],
    );
    return mapThread(result.rows[0] as Record<string, unknown>);
  }

  async listThreadsForStudentIds(
    tenantId: string,
    studentIds: string[],
  ): Promise<MessageThreadEntity[]> {
    await this.ensureSchema();
    if (studentIds.length === 0) return [];
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_message_threads
       WHERE tenant_id = $1 AND student_id = ANY($2::uuid[])
       ORDER BY updated_at DESC`,
      [tenantId, studentIds],
    );
    return result.rows.map((row) => mapThread(row as Record<string, unknown>));
  }

  async findThreadById(id: string, tenantId: string): Promise<MessageThreadEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_message_threads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapThread(result.rows[0] as Record<string, unknown>);
  }

  async createMessage(data: Omit<MessageEntity, 'createdAt'>): Promise<MessageEntity> {
    await this.ensureSchema();
    const insertResult = await this.query(
      data.tenantId,
      `INSERT INTO parent_messages (
         id, thread_id, tenant_id, sender_user_id, sender_role, body
       ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.id, data.threadId, data.tenantId, data.senderUserId, data.senderRole, data.body],
    );
    await this.query(
      data.tenantId,
      `UPDATE parent_message_threads SET updated_at = now() WHERE id = $1 AND tenant_id = $2`,
      [data.threadId, data.tenantId],
    );
    return mapMessage(insertResult.rows[0] as Record<string, unknown>);
  }

  async listMessagesForThread(tenantId: string, threadId: string): Promise<MessageEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_messages
       WHERE tenant_id = $1 AND thread_id = $2
       ORDER BY created_at ASC`,
      [tenantId, threadId],
    );
    return result.rows.map((row) => mapMessage(row as Record<string, unknown>));
  }

  async createConsent(
    data: Omit<ConsentEntity, 'createdAt' | 'updatedAt' | 'decidedAt'>,
  ): Promise<ConsentEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO parent_consents (
         id, tenant_id, student_id, parent_user_id, consent_type, title, description, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.parentUserId,
        data.consentType,
        data.title,
        data.description,
        data.status,
        data.createdBy,
      ],
    );
    return mapConsent(result.rows[0] as Record<string, unknown>);
  }

  async listConsentsForParent(tenantId: string, parentUserId: string): Promise<ConsentEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_consents
       WHERE tenant_id = $1 AND parent_user_id = $2
       ORDER BY created_at DESC`,
      [tenantId, parentUserId],
    );
    return result.rows.map((row) => mapConsent(row as Record<string, unknown>));
  }

  async findConsentById(id: string, tenantId: string): Promise<ConsentEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_consents WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapConsent(result.rows[0] as Record<string, unknown>);
  }

  async updateConsent(
    id: string,
    tenantId: string,
    data: Partial<Pick<ConsentEntity, 'status' | 'decidedAt'>>,
  ): Promise<ConsentEntity | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (data.status !== undefined) {
      sets.push(`status = $${i++}`);
      values.push(data.status);
    }
    if (data.decidedAt !== undefined) {
      sets.push(`decided_at = $${i++}`);
      values.push(data.decidedAt);
    }

    if (sets.length === 0) {
      return this.findConsentById(id, tenantId);
    }

    sets.push(`updated_at = now()`);
    values.push(id, tenantId);

    const result = await this.query(
      tenantId,
      `UPDATE parent_consents
       SET ${sets.join(', ')}
       WHERE id = $${i++} AND tenant_id = $${i}
       RETURNING *`,
      values,
    );
    if (!result.rows[0]) return null;
    return mapConsent(result.rows[0] as Record<string, unknown>);
  }

  async createFeePlan(
    data: Omit<FeePlanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeePlanEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
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
  }

  async listFeePlans(tenantId: string): Promise<FeePlanEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_fee_plans WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapPlan(row as Record<string, unknown>));
  }

  async findFeePlanById(id: string, tenantId: string): Promise<FeePlanEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_fee_plans WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapPlan(result.rows[0] as Record<string, unknown>);
  }

  async createInvoice(
    data: Omit<FeeInvoiceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeeInvoiceEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
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
  }

  async listInvoicesForStudentIds(
    tenantId: string,
    studentIds: string[],
  ): Promise<FeeInvoiceEntity[]> {
    await this.ensureSchema();
    if (studentIds.length === 0) return [];
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_fee_invoices
       WHERE tenant_id = $1 AND student_id = ANY($2::uuid[])
       ORDER BY created_at DESC`,
      [tenantId, studentIds],
    );
    return result.rows.map((row) => mapInvoice(row as Record<string, unknown>));
  }

  async listInvoicesForTenant(tenantId: string): Promise<FeeInvoiceEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_fee_invoices WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapInvoice(row as Record<string, unknown>));
  }

  async findInvoiceById(id: string, tenantId: string): Promise<FeeInvoiceEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_fee_invoices WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapInvoice(result.rows[0] as Record<string, unknown>);
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
    const result = await this.query(
      tenantId,
      `UPDATE parent_fee_invoices
       SET status = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [data.status, id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapInvoice(result.rows[0] as Record<string, unknown>);
  }

  async createPayment(data: Omit<FeePaymentEntity, 'createdAt'>): Promise<FeePaymentEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
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
  }

  async listPaymentsForTenant(tenantId: string): Promise<FeePaymentEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_fee_payments WHERE tenant_id = $1 ORDER BY paid_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapPayment(row as Record<string, unknown>));
  }

  async createReceipt(data: Omit<FeeReceiptEntity, 'createdAt'>): Promise<FeeReceiptEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
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
  }

  async listReceiptsForTenant(tenantId: string): Promise<FeeReceiptEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_fee_receipts WHERE tenant_id = $1 ORDER BY issued_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapReceipt(row as Record<string, unknown>));
  }

  async listReceiptsForInvoiceIds(
    tenantId: string,
    invoiceIds: string[],
  ): Promise<FeeReceiptEntity[]> {
    await this.ensureSchema();
    if (invoiceIds.length === 0) return [];
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_fee_receipts
       WHERE tenant_id = $1 AND invoice_id = ANY($2::uuid[])
       ORDER BY issued_at DESC`,
      [tenantId, invoiceIds],
    );
    return result.rows.map((row) => mapReceipt(row as Record<string, unknown>));
  }

  async findReceiptById(id: string, tenantId: string): Promise<FeeReceiptEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM parent_fee_receipts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapReceipt(result.rows[0] as Record<string, unknown>);
  }
}

export function createPgParentPortalRepository(): PgParentPortalRepository | null {
  const pool = getSharedParentPortalPool();
  if (!pool) return null;
  return new PgParentPortalRepository(pool);
}
