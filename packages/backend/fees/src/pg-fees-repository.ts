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
  ConcessionKind,
  ConcessionStatus,
  FeeConcessionEntity,
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
  FeeReconciliationBatchEntity,
  FeeReconciliationRowEntity,
  FeeCreditNoteEntity,
  FeeRefundEntity,
  FeeWriteOffEntity,
  FeeStructureComponentEntity,
  FeeStructureEntity,
  FeeStructureInstalmentEntity,
  FeeStructureStatus,
  FeesRepository,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
} from './fees-repository.js';
import type { ReminderSendAuditEntity, ReminderSuppressionEntity } from './reminder-sandbox.js';

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
      const sql031 = readFileSync(resolveSqlPath('031_fees_structures_schema.sql'), 'utf8');
      await pool.query(sql031);
      const sql048 = readFileSync(resolveSqlPath('048_fees_recon_exception_audit.sql'), 'utf8');
      await pool.query(sql048);
      const sql057 = readFileSync(resolveSqlPath('057_fees_payment_idempotency.sql'), 'utf8');
      await pool.query(sql057);
      const sql058 = readFileSync(resolveSqlPath('058_fees_reminder_durable_state.sql'), 'utf8');
      await pool.query(sql058);
      const sql059 = readFileSync(resolveSqlPath('059_fees_writeoff_creditnote.sql'), 'utf8');
      await pool.query(sql059);
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
    invoiceNumber: row.invoice_number == null ? null : String(row.invoice_number),
    structureId: row.structure_id == null ? null : String(row.structure_id),
    classId: row.class_id == null ? null : String(row.class_id),
    gradeId: row.grade_id == null ? null : String(row.grade_id),
  };
}


function mapReminderSuppression(row: Record<string, unknown>): ReminderSuppressionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: row.student_id == null ? null : String(row.student_id),
    invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
    reason: String(row.reason),
    createdBy: String(row.created_by),
    createdAt: toDate(row.created_at),
  };
}

function mapReminderSendAudit(row: Record<string, unknown>): ReminderSendAuditEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    invoiceId: String(row.invoice_id),
    studentId: String(row.student_id),
    channel: String(row.channel) as ReminderSendAuditEntity['channel'],
    messageId: String(row.message_id),
    mode: 'sandbox',
    honestyNote: String(row.honesty_note),
    actorId: String(row.actor_id),
    createdAt: toDate(row.created_at),
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
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
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

function mapStructure(row: Record<string, unknown>): FeeStructureEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: row.institution_id == null ? null : String(row.institution_id),
    academicPeriodId: row.academic_period_id == null ? null : String(row.academic_period_id),
    gradeId: row.grade_id == null ? null : String(row.grade_id),
    classId: row.class_id == null ? null : String(row.class_id),
    category: String(row.category),
    term: row.term == null ? null : String(row.term),
    code: String(row.code),
    name: String(row.name),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    status: String(row.status) as FeeStructureStatus,
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapComponent(row: Record<string, unknown>): FeeStructureComponentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    structureId: String(row.structure_id),
    name: String(row.name),
    amountCents: Number(row.amount_cents),
    createdAt: toDate(row.created_at),
  };
}

function mapInstalment(row: Record<string, unknown>): FeeStructureInstalmentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    structureId: String(row.structure_id),
    sequence: Number(row.sequence),
    amountCents: Number(row.amount_cents),
    dueOffsetDays: Number(row.due_offset_days),
    label: String(row.label ?? ''),
    createdAt: toDate(row.created_at),
  };
}

function mapConcession(row: Record<string, unknown>): FeeConcessionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    structureId: String(row.structure_id),
    invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
    kind: String(row.kind) as ConcessionKind,
    percent: row.percent == null ? null : Number(row.percent),
    amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    reason: String(row.reason),
    approverId: row.approver_id == null ? null : String(row.approver_id),
    status: String(row.status) as ConcessionStatus,
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
  };
}


function mapCreditNote(row: Record<string, unknown>): FeeCreditNoteEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    invoiceId: String(row.invoice_id),
    amountCents: Number(row.amount_cents),
    reason: String(row.reason),
    status: String(row.status) as FeeCreditNoteEntity['status'],
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
  };
}

function mapWriteOff(row: Record<string, unknown>): FeeWriteOffEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    invoiceId: String(row.invoice_id),
    amountCents: Number(row.amount_cents),
    reason: String(row.reason),
    status: String(row.status) as FeeWriteOffEntity['status'],
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
  };
}

function mapRefund(row: Record<string, unknown>): FeeRefundEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    invoiceId: String(row.invoice_id),
    paymentId: row.payment_id == null ? null : String(row.payment_id),
    amountCents: Number(row.amount_cents),
    reason: String(row.reason),
    status: String(row.status) as RefundStatus,
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
  };
}

function mapReconBatch(row: Record<string, unknown>): FeeReconciliationBatchEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    filename: String(row.filename ?? ''),
    matchedCount: Number(row.matched_count),
    unmatchedCount: Number(row.unmatched_count),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
  };
}

function mapReconRow(row: Record<string, unknown>): FeeReconciliationRowEntity {
  const matched = Boolean(row.matched);
  const rawStatus = row.exception_status == null ? null : String(row.exception_status);
  const exceptionStatus =
    rawStatus === 'open' ||
    rawStatus === 'resolved' ||
    rawStatus === 'ignored' ||
    rawStatus === 'none'
      ? rawStatus
      : matched
        ? 'none'
        : 'open';
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    batchId: String(row.batch_id),
    invoiceNumber: String(row.invoice_number),
    amountCents: Number(row.amount_cents),
    matched,
    invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
    note: row.note == null ? null : String(row.note),
    exceptionStatus,
    resolvedBy: row.resolved_by == null ? null : String(row.resolved_by),
    resolvedAt: row.resolved_at == null ? null : toDate(row.resolved_at),
    resolutionNote: row.resolution_note == null ? null : String(row.resolution_note),
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
        bad_debt_expense: 0,
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
           id, tenant_id, student_id, plan_id, title, description, amount_cents, currency, status, due_at, created_by,
           invoice_number, structure_id, class_id, grade_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
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
          data.invoiceNumber,
          data.structureId,
          data.classId,
          data.gradeId,
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

  async listInvoicesForStudentIds(
    tenantId: string,
    studentIds: string[],
  ): Promise<FeeInvoiceEntity[]> {
    if (studentIds.length === 0) return [];
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_invoices
         WHERE tenant_id = $1 AND student_id = ANY($2::uuid[])
         ORDER BY created_at DESC`,
        [tenantId, studentIds],
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

  async findInvoiceByNumber(
    tenantId: string,
    invoiceNumber: string,
  ): Promise<FeeInvoiceEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_invoices
         WHERE tenant_id = $1 AND invoice_number = $2 LIMIT 1`,
        [tenantId, invoiceNumber],
      );
      if (!result.rows[0]) return null;
      return mapInvoice(result.rows[0] as Record<string, unknown>);
    });
  }

  async findInvoiceForStructureStudent(
    tenantId: string,
    structureId: string,
    studentId: string,
  ): Promise<FeeInvoiceEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_invoices
         WHERE tenant_id = $1 AND structure_id = $2 AND student_id = $3 AND status <> 'void'
         LIMIT 1`,
        [tenantId, structureId, studentId],
      );
      if (!result.rows[0]) return null;
      return mapInvoice(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateInvoice(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeInvoiceEntity, 'status' | 'amountCents'>>,
  ): Promise<FeeInvoiceEntity | null> {
    await this.ensureSchema();
    if (data.status === undefined && data.amountCents === undefined) {
      return this.findInvoiceById(id, tenantId);
    }
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE parent_fee_invoices
         SET status = COALESCE($1, status),
             amount_cents = COALESCE($2, amount_cents),
             updated_at = now()
         WHERE id = $3 AND tenant_id = $4
         RETURNING *`,
        [data.status ?? null, data.amountCents ?? null, id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapInvoice(result.rows[0] as Record<string, unknown>);
    });
  }

  async listStudentIdsForScope(
    tenantId: string,
    scope: { classId?: string | null; gradeId?: string | null },
  ): Promise<string[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      try {
        const result = await client.query(
          `SELECT student_id FROM enrollments
           WHERE tenant_id = $1
             AND status::text IN ('ENROLLED', 'enrolled')
             AND ($2::uuid IS NULL OR class_id = $2)
             AND ($3::uuid IS NULL OR grade_id = $3)`,
          [tenantId, scope.classId ?? null, scope.gradeId ?? null],
        );
        return result.rows.map((row) => String((row as { student_id: string }).student_id));
      } catch {
        return [];
      }
    });
  }

  async createPayment(data: Omit<FeePaymentEntity, 'createdAt'>): Promise<FeePaymentEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO parent_fee_payments (
           id, invoice_id, tenant_id, payer_user_id, amount_cents, method, status, paid_at,
           idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          data.id,
          data.invoiceId,
          data.tenantId,
          data.payerUserId,
          data.amountCents,
          data.method,
          data.status,
          data.paidAt,
          data.idempotencyKey,
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

  async findPaymentByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<FeePaymentEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM parent_fee_payments
          WHERE tenant_id = $1 AND idempotency_key = $2
          LIMIT 1`,
        [tenantId, idempotencyKey],
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

  async listReminderSuppressions(tenantId: string): Promise<ReminderSuppressionEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_reminder_suppressions WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapReminderSuppression(row as Record<string, unknown>));
    });
  }

  async createReminderSuppression(
    data: ReminderSuppressionEntity,
  ): Promise<ReminderSuppressionEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO fee_reminder_suppressions (
           id, tenant_id, student_id, invoice_id, reason, created_by, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.invoiceId,
          data.reason,
          data.createdBy,
          data.createdAt,
        ],
      );
      return mapReminderSuppression(result.rows[0] as Record<string, unknown>);
    });
  }

  async deleteReminderSuppression(tenantId: string, suppressionId: string): Promise<boolean> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM fee_reminder_suppressions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, suppressionId],
      );
      return Number(result.rowCount ?? 0) > 0;
    });
  }

  async listReminderSendAudits(tenantId: string): Promise<ReminderSendAuditEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_reminder_send_audits WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapReminderSendAudit(row as Record<string, unknown>));
    });
  }

  async createReminderSendAudit(
    data: ReminderSendAuditEntity,
  ): Promise<ReminderSendAuditEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO fee_reminder_send_audits (
           id, tenant_id, invoice_id, student_id, channel, message_id, mode, honesty_note, actor_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.invoiceId,
          data.studentId,
          data.channel,
          data.messageId,
          data.mode,
          data.honestyNote,
          data.actorId,
          data.createdAt,
        ],
      );
      return mapReminderSendAudit(result.rows[0] as Record<string, unknown>);
    });
  }

  async createFeeStructure(
    data: Omit<FeeStructureEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeeStructureEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO fee_structures (
           id, tenant_id, institution_id, academic_period_id, grade_id, class_id,
           category, term, code, name, amount_cents, currency, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.institutionId,
          data.academicPeriodId,
          data.gradeId,
          data.classId,
          data.category,
          data.term,
          data.code,
          data.name,
          data.amountCents,
          data.currency,
          data.status,
          data.createdBy,
        ],
      );
      return mapStructure(result.rows[0] as Record<string, unknown>);
    });
  }

  async listFeeStructures(tenantId: string): Promise<FeeStructureEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_structures WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapStructure(row as Record<string, unknown>));
    });
  }

  async findFeeStructureById(id: string, tenantId: string): Promise<FeeStructureEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_structures WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapStructure(result.rows[0] as Record<string, unknown>);
    });
  }

  async replaceStructureInstalments(
    tenantId: string,
    structureId: string,
    rows: Omit<FeeStructureInstalmentEntity, 'createdAt'>[],
  ): Promise<FeeStructureInstalmentEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      await client.query(
        `DELETE FROM fee_structure_instalments WHERE tenant_id = $1 AND structure_id = $2`,
        [tenantId, structureId],
      );
      const out: FeeStructureInstalmentEntity[] = [];
      for (const row of rows) {
        const result = await client.query(
          `INSERT INTO fee_structure_instalments (
             id, tenant_id, structure_id, sequence, amount_cents, due_offset_days, label
           ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            row.id,
            row.tenantId,
            row.structureId,
            row.sequence,
            row.amountCents,
            row.dueOffsetDays,
            row.label,
          ],
        );
        out.push(mapInstalment(result.rows[0] as Record<string, unknown>));
      }
      return out;
    });
  }

  async listStructureInstalments(
    tenantId: string,
    structureId: string,
  ): Promise<FeeStructureInstalmentEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_structure_instalments
         WHERE tenant_id = $1 AND structure_id = $2 ORDER BY sequence ASC`,
        [tenantId, structureId],
      );
      return result.rows.map((row) => mapInstalment(row as Record<string, unknown>));
    });
  }

  async replaceStructureComponents(
    tenantId: string,
    structureId: string,
    rows: Omit<FeeStructureComponentEntity, 'createdAt'>[],
  ): Promise<FeeStructureComponentEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      await client.query(
        `DELETE FROM fee_structure_components WHERE tenant_id = $1 AND structure_id = $2`,
        [tenantId, structureId],
      );
      const out: FeeStructureComponentEntity[] = [];
      for (const row of rows) {
        const result = await client.query(
          `INSERT INTO fee_structure_components (
             id, tenant_id, structure_id, name, amount_cents
           ) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [row.id, row.tenantId, row.structureId, row.name, row.amountCents],
        );
        out.push(mapComponent(result.rows[0] as Record<string, unknown>));
      }
      return out;
    });
  }

  async listStructureComponents(
    tenantId: string,
    structureId: string,
  ): Promise<FeeStructureComponentEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_structure_components WHERE tenant_id = $1 AND structure_id = $2`,
        [tenantId, structureId],
      );
      return result.rows.map((row) => mapComponent(row as Record<string, unknown>));
    });
  }

  async createConcession(
    data: Omit<FeeConcessionEntity, 'createdAt'>,
  ): Promise<FeeConcessionEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO fee_concessions (
           id, tenant_id, student_id, structure_id, invoice_id, kind, percent,
           amount_cents, reason, approver_id, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.structureId,
          data.invoiceId,
          data.kind,
          data.percent,
          data.amountCents,
          data.reason,
          data.approverId,
          data.status,
          data.createdBy,
        ],
      );
      return mapConcession(result.rows[0] as Record<string, unknown>);
    });
  }

  async findConcessionForStudentStructure(
    tenantId: string,
    studentId: string,
    structureId: string,
  ): Promise<FeeConcessionEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_concessions
         WHERE tenant_id = $1 AND student_id = $2 AND structure_id = $3
           AND status <> 'rejected'
         LIMIT 1`,
        [tenantId, studentId, structureId],
      );
      if (!result.rows[0]) return null;
      return mapConcession(result.rows[0] as Record<string, unknown>);
    });
  }

  async listConcessions(tenantId: string): Promise<FeeConcessionEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_concessions WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapConcession(row as Record<string, unknown>));
    });
  }

  async findConcessionById(id: string, tenantId: string): Promise<FeeConcessionEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_concessions WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapConcession(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateConcession(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeConcessionEntity, 'invoiceId' | 'status' | 'approverId'>>,
  ): Promise<FeeConcessionEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE fee_concessions
         SET invoice_id = COALESCE($1, invoice_id),
             status = COALESCE($2, status),
             approver_id = COALESCE($3, approver_id)
         WHERE id = $4 AND tenant_id = $5
         RETURNING *`,
        [
          data.invoiceId ?? null,
          data.status ?? null,
          data.approverId ?? null,
          id,
          tenantId,
        ],
      );
      if (!result.rows[0]) return null;
      return mapConcession(result.rows[0] as Record<string, unknown>);
    });
  }


  async createCreditNote(data: Omit<FeeCreditNoteEntity, 'createdAt'>): Promise<FeeCreditNoteEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO fee_credit_notes (
           id, tenant_id, invoice_id, amount_cents, reason, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.invoiceId,
          data.amountCents,
          data.reason,
          data.status,
          data.createdBy,
        ],
      );
      return mapCreditNote(result.rows[0] as Record<string, unknown>);
    });
  }

  async listCreditNotesForInvoice(tenantId: string, invoiceId: string): Promise<FeeCreditNoteEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_credit_notes WHERE tenant_id = $1 AND invoice_id = $2`,
        [tenantId, invoiceId],
      );
      return result.rows.map((row) => mapCreditNote(row as Record<string, unknown>));
    });
  }

  async listCreditNotesForTenant(tenantId: string): Promise<FeeCreditNoteEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_credit_notes WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapCreditNote(row as Record<string, unknown>));
    });
  }

  async createWriteOff(data: Omit<FeeWriteOffEntity, 'createdAt'>): Promise<FeeWriteOffEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO fee_write_offs (
           id, tenant_id, invoice_id, amount_cents, reason, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.invoiceId,
          data.amountCents,
          data.reason,
          data.status,
          data.createdBy,
        ],
      );
      return mapWriteOff(result.rows[0] as Record<string, unknown>);
    });
  }

  async listWriteOffsForInvoice(tenantId: string, invoiceId: string): Promise<FeeWriteOffEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_write_offs WHERE tenant_id = $1 AND invoice_id = $2`,
        [tenantId, invoiceId],
      );
      return result.rows.map((row) => mapWriteOff(row as Record<string, unknown>));
    });
  }

  async listWriteOffsForTenant(tenantId: string): Promise<FeeWriteOffEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_write_offs WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapWriteOff(row as Record<string, unknown>));
    });
  }

  async createRefund(data: Omit<FeeRefundEntity, 'createdAt'>): Promise<FeeRefundEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO fee_refunds (
           id, tenant_id, invoice_id, payment_id, amount_cents, reason, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.invoiceId,
          data.paymentId,
          data.amountCents,
          data.reason,
          data.status,
          data.createdBy,
        ],
      );
      return mapRefund(result.rows[0] as Record<string, unknown>);
    });
  }

  async listRefundsForInvoice(tenantId: string, invoiceId: string): Promise<FeeRefundEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_refunds WHERE tenant_id = $1 AND invoice_id = $2`,
        [tenantId, invoiceId],
      );
      return result.rows.map((row) => mapRefund(row as Record<string, unknown>));
    });
  }

  async listRefundsForTenant(tenantId: string): Promise<FeeRefundEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_refunds WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapRefund(row as Record<string, unknown>));
    });
  }

  async createReconciliationBatch(
    data: Omit<FeeReconciliationBatchEntity, 'createdAt'>,
  ): Promise<FeeReconciliationBatchEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO fee_reconciliation_batches (
           id, tenant_id, filename, matched_count, unmatched_count, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.filename,
          data.matchedCount,
          data.unmatchedCount,
          data.createdBy,
        ],
      );
      return mapReconBatch(result.rows[0] as Record<string, unknown>);
    });
  }

  async createReconciliationRows(
    rows: Omit<FeeReconciliationRowEntity, 'createdAt'>[],
  ): Promise<FeeReconciliationRowEntity[]> {
    if (rows.length === 0) return [];
    await this.ensureSchema();
    const tenantId = rows[0]!.tenantId;
    return this.withTenant(tenantId, async (client) => {
      const out: FeeReconciliationRowEntity[] = [];
      for (const row of rows) {
        const result = await client.query(
          `INSERT INTO fee_reconciliation_rows (
             id, tenant_id, batch_id, invoice_number, amount_cents, matched, invoice_id, note,
             exception_status, resolved_by, resolved_at, resolution_note
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            row.id,
            row.tenantId,
            row.batchId,
            row.invoiceNumber,
            row.amountCents,
            row.matched,
            row.invoiceId,
            row.note,
            row.exceptionStatus,
            row.resolvedBy,
            row.resolvedAt,
            row.resolutionNote,
          ],
        );
        out.push(mapReconRow(result.rows[0] as Record<string, unknown>));
      }
      return out;
    });
  }

  async listReconciliationBatches(tenantId: string): Promise<FeeReconciliationBatchEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_reconciliation_batches WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapReconBatch(row as Record<string, unknown>));
    });
  }

  async listReconciliationRows(
    tenantId: string,
    batchId: string,
  ): Promise<FeeReconciliationRowEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_reconciliation_rows WHERE tenant_id = $1 AND batch_id = $2 ORDER BY created_at ASC`,
        [tenantId, batchId],
      );
      return result.rows.map((row) => mapReconRow(row as Record<string, unknown>));
    });
  }

  async findReconciliationRowById(
    tenantId: string,
    rowId: string,
  ): Promise<FeeReconciliationRowEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM fee_reconciliation_rows WHERE tenant_id = $1 AND id = $2`,
        [tenantId, rowId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapReconRow(row) : null;
    });
  }

  async updateReconciliationRow(
    tenantId: string,
    rowId: string,
    data: Partial<
      Pick<
        FeeReconciliationRowEntity,
        'exceptionStatus' | 'resolvedBy' | 'resolvedAt' | 'resolutionNote' | 'note'
      >
    >,
  ): Promise<FeeReconciliationRowEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM fee_reconciliation_rows WHERE tenant_id = $1 AND id = $2`,
        [tenantId, rowId],
      );
      const current = existing.rows[0] as Record<string, unknown> | undefined;
      if (!current) return null;
      const next = mapReconRow(current);
      if (data.exceptionStatus !== undefined) next.exceptionStatus = data.exceptionStatus;
      if (data.resolvedBy !== undefined) next.resolvedBy = data.resolvedBy;
      if (data.resolvedAt !== undefined) next.resolvedAt = data.resolvedAt;
      if (data.resolutionNote !== undefined) next.resolutionNote = data.resolutionNote;
      if (data.note !== undefined) next.note = data.note;
      const result = await client.query(
        `UPDATE fee_reconciliation_rows SET
           exception_status = $3,
           resolved_by = $4,
           resolved_at = $5,
           resolution_note = $6,
           note = $7
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          rowId,
          next.exceptionStatus,
          next.resolvedBy,
          next.resolvedAt,
          next.resolutionNote,
          next.note,
        ],
      );
      return mapReconRow(result.rows[0] as Record<string, unknown>);
    });
  }
}

export function createPgFeesRepository(): PgFeesRepository | null {
  const pool = getSharedFeesPool();
  if (!pool) return null;
  return new PgFeesRepository(pool);
}
