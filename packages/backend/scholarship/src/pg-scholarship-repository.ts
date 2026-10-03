/**
 * Postgres-backed scholarship repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, programs / applications / disbursements persist via
 * db/sql/016_scholarships_schema.sql. Uses withPgTenant for RLS (G-103 / G-204).
 */
import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { majorUnitsNumberFromCents, pgIntegerCents, pgNumericMajorToCents } from '@proctira/common';
import {
  createDatabaseSchemaReadinessCheck,
  getSharedPgPool,
  withPgTenant,
  type PgQueryable,
} from '@proctira/database';
import type pg from 'pg';

import type {
  AcademicRecord,
  ApplicationDocument,
  EligibilityCriteria,
  FinancialInfo,
} from './schemas.js';
import type { ScholarshipTxClient } from './scholarship-fee-outbox.js';
import type {
  ApplicationFilter,
  ApplicationStatus,
  ComplianceRecordEntity,
  ComplianceStatus,
  ComplianceType,
  DisbursementEntity,
  DisbursementFilter,
  DisbursementFrequency,
  PaymentMethod,
  PaymentStatus,
  ProgramFilter,
  ProgramStatus,
  ScholarshipApplicationEntity,
  ScholarshipProgramEntity,
  ScholarshipRepository,
  UtilizationReportData,
  UtilizationReportFilter,
  ApproveApplicationCommand,
  ApproveApplicationOutcome,
} from './scholarship-repository.js';
import { APPROVABLE_APPLICATION_STATUSES } from './scholarship-repository.js';
import { buildUtilizationReport, UTILIZATION_GROUP_EXPR } from './utilization-report.js';

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

const ensureScholarshipSchemaReady = createDatabaseSchemaReadinessCheck(
  'scholarships',
  'scholarships',
);

export function getSharedScholarshipPool(): pg.Pool | null {
  return getSharedPgPool();
}

export async function ensureScholarshipSchema(
  pool: PgPoolLike = getSharedScholarshipPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for scholarship schema ensure');
  await ensureScholarshipSchemaReady(pool);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  return toDate(value);
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function resolveAmountCents(centsRaw: unknown, majorRaw: unknown): number {
  if (centsRaw != null) return pgIntegerCents(centsRaw);
  return pgNumericMajorToCents(majorRaw);
}

function mapProgram(row: Record<string, unknown>): ScholarshipProgramEntity {
  const amountPerRecipientCents = resolveAmountCents(
    row.amount_per_recipient_cents,
    row.amount_per_recipient,
  );
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    applicationStartDate: dateOnly(row.application_start_date),
    applicationEndDate: dateOnly(row.application_end_date),
    totalSlots: Number(row.total_slots),
    usedSlots: Number(row.used_slots),
    amountPerRecipient: majorUnitsNumberFromCents(amountPerRecipientCents),
    amountPerRecipientCents,
    currency: String(row.currency),
    disbursementFrequency: String(row.disbursement_frequency) as DisbursementFrequency,
    eligibility: parseJson<EligibilityCriteria>(row.eligibility, {}),
    status: String(row.status) as ProgramStatus,
    academicPeriodId: row.academic_period_id == null ? null : String(row.academic_period_id),
    fundingSourceId: row.funding_source_id == null ? null : String(row.funding_source_id),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapApplication(row: Record<string, unknown>): ScholarshipApplicationEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    programId: String(row.program_id),
    applicantId: String(row.applicant_id),
    institutionId: String(row.institution_id),
    status: String(row.status) as ApplicationStatus,
    academicRecords: parseJson<AcademicRecord[]>(row.academic_records, []),
    financialInfo: parseJson<FinancialInfo>(row.financial_info, {}),
    documents: parseJson<ApplicationDocument[]>(row.documents, []),
    personalStatement: row.personal_statement == null ? null : String(row.personal_statement),
    areaId: row.area_id == null ? null : String(row.area_id),
    gender: row.gender == null ? null : String(row.gender),
    workflowInstanceId: row.workflow_instance_id == null ? null : String(row.workflow_instance_id),
    submittedAt: toDate(row.submitted_at),
    reviewedAt: toDateOrNull(row.reviewed_at),
    reviewerId: row.reviewer_id == null ? null : String(row.reviewer_id),
    reviewNotes: row.review_notes == null ? null : String(row.review_notes),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapDisbursement(row: Record<string, unknown>): DisbursementEntity {
  const amountCents = resolveAmountCents(row.amount_cents, row.amount);
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    applicationId: String(row.application_id),
    amount: majorUnitsNumberFromCents(amountCents),
    amountCents,
    scheduledDate: dateOnly(row.scheduled_date),
    paidDate: row.paid_date == null ? null : dateOnly(row.paid_date),
    paymentStatus: String(row.payment_status) as PaymentStatus,
    paymentMethod:
      row.payment_method == null ? null : (String(row.payment_method) as PaymentMethod),
    transactionReference:
      row.transaction_reference == null ? null : String(row.transaction_reference),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapCompliance(row: Record<string, unknown>): ComplianceRecordEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    applicationId: String(row.application_id),
    complianceType: String(row.compliance_type) as ComplianceType,
    status: String(row.status) as ComplianceStatus,
    evaluationDate: dateOnly(row.evaluation_date),
    details: row.details == null ? null : String(row.details),
    evaluatorId: row.evaluator_id == null ? null : String(row.evaluator_id),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function paginateMeta(totalItems: number, pagination: PaginationOptions) {
  const totalPages = Math.ceil(totalItems / pagination.pageSize) || 1;
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalItems,
    totalPages,
  };
}

/** PRC-L348: escape LIKE metacharacters so search is a literal substring match. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** PRC-L348: whitelisted sortBy -> column maps (never interpolate client input). */
const PROGRAM_SORT_COLUMNS: Record<string, string> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  name: 'name',
  status: 'status',
  applicationStartDate: 'application_start_date',
  applicationEndDate: 'application_end_date',
};
const APPLICATION_SORT_COLUMNS: Record<string, string> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  submittedAt: 'submitted_at',
  status: 'status',
};
const DISBURSEMENT_SORT_COLUMNS: Record<string, string> = {
  scheduledDate: 'scheduled_date',
  paidDate: 'paid_date',
  createdAt: 'created_at',
  amount: 'amount_cents',
  paymentStatus: 'payment_status',
};

export function orderByClause(
  columns: Record<string, string>,
  pagination: PaginationOptions,
  fallback: { column: string; order: 'asc' | 'desc' },
): string {
  const mapped = pagination.sortBy ? columns[pagination.sortBy] : undefined;
  const column = mapped ?? fallback.column;
  const order = mapped
    ? pagination.sortOrder === 'asc'
      ? 'ASC'
      : 'DESC'
    : fallback.order.toUpperCase();
  // Stable tie-break on id so pages do not overlap.
  return `ORDER BY ${column} ${order}, id ${order}`;
}

export class PgScholarshipRepository implements ScholarshipRepository {
  constructor(private readonly pool: PgPoolLike) {}

  async ensureSchema(): Promise<void> {
    await ensureScholarshipSchema(this.pool);
  }

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async createProgram(
    data: Omit<ScholarshipProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScholarshipProgramEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO scholarship_programs (
           id, tenant_id, name, description, application_start_date, application_end_date,
           total_slots, used_slots, amount_per_recipient, amount_per_recipient_cents, currency,
           disbursement_frequency, eligibility, status, academic_period_id, funding_source_id
         ) VALUES (
           $1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16
         ) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.name,
          data.description,
          data.applicationStartDate,
          data.applicationEndDate,
          data.totalSlots,
          data.usedSlots,
          data.amountPerRecipient,
          data.amountPerRecipientCents,
          data.currency,
          data.disbursementFrequency,
          JSON.stringify(data.eligibility ?? {}),
          data.status,
          data.academicPeriodId,
          data.fundingSourceId,
        ],
      );
      return mapProgram(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateProgram(
    id: string,
    tenantId: string,
    data: Partial<ScholarshipProgramEntity>,
  ): Promise<ScholarshipProgramEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existingResult = await client.query(
        `SELECT * FROM scholarship_programs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!existingResult.rows[0]) return null;
      const existing = mapProgram(existingResult.rows[0] as Record<string, unknown>);
      const merged = { ...existing, ...data, id: existing.id, tenantId: existing.tenantId };
      const result = await client.query(
        `UPDATE scholarship_programs SET
           name = $3, description = $4, application_start_date = $5::date,
           application_end_date = $6::date, total_slots = $7, used_slots = $8,
           amount_per_recipient = $9, amount_per_recipient_cents = $10, currency = $11,
           disbursement_frequency = $12, eligibility = $13::jsonb, status = $14,
           academic_period_id = $15, funding_source_id = $16, updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          merged.name,
          merged.description,
          merged.applicationStartDate,
          merged.applicationEndDate,
          merged.totalSlots,
          merged.usedSlots,
          merged.amountPerRecipient,
          merged.amountPerRecipientCents,
          merged.currency,
          merged.disbursementFrequency,
          JSON.stringify(merged.eligibility ?? {}),
          merged.status,
          merged.academicPeriodId,
          merged.fundingSourceId,
        ],
      );
      if (!result.rows[0]) return null;
      return mapProgram(result.rows[0] as Record<string, unknown>);
    });
  }

  async findProgramById(id: string, tenantId: string): Promise<ScholarshipProgramEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM scholarship_programs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapProgram(result.rows[0] as Record<string, unknown>);
    });
  }

  async listPrograms(
    tenantId: string,
    filter: ProgramFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipProgramEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const conditions = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter.status) {
        params.push(filter.status);
        conditions.push(`status = $${params.length}`);
      }
      if (filter.search) {
        params.push(`%${escapeLikePattern(filter.search.toLowerCase())}%`);
        conditions.push(`lower(name) LIKE $${params.length} ESCAPE '\\'`);
      }
      const where = conditions.join(' AND ');
      const countResult = await client.query(
        `SELECT count(*)::int AS c FROM scholarship_programs WHERE ${where}`,
        params,
      );
      const totalItems = Number((countResult.rows[0] as { c: number }).c);
      const offset = (pagination.page - 1) * pagination.pageSize;
      params.push(pagination.pageSize, offset);
      const result = await client.query(
        `SELECT * FROM scholarship_programs WHERE ${where}
         ${orderByClause(PROGRAM_SORT_COLUMNS, pagination, { column: 'created_at', order: 'desc' })}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapProgram(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  async deleteProgram(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM scholarship_programs WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }

  async createApplication(
    data: Omit<ScholarshipApplicationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScholarshipApplicationEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO scholarship_applications (
           id, tenant_id, program_id, applicant_id, institution_id, status,
           academic_records, financial_info, documents, personal_statement,
           area_id, gender, workflow_instance_id, submitted_at, reviewed_at,
           reviewer_id, review_notes
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17
         ) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.programId,
          data.applicantId,
          data.institutionId,
          data.status,
          JSON.stringify(data.academicRecords ?? []),
          JSON.stringify(data.financialInfo ?? {}),
          JSON.stringify(data.documents ?? []),
          data.personalStatement,
          data.areaId,
          data.gender,
          data.workflowInstanceId,
          data.submittedAt,
          data.reviewedAt,
          data.reviewerId ?? null,
          data.reviewNotes ?? null,
        ],
      );
      return mapApplication(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateApplication(
    id: string,
    tenantId: string,
    data: Partial<ScholarshipApplicationEntity>,
  ): Promise<ScholarshipApplicationEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existingResult = await client.query(
        `SELECT * FROM scholarship_applications WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!existingResult.rows[0]) return null;
      const existing = mapApplication(existingResult.rows[0] as Record<string, unknown>);
      const merged = { ...existing, ...data, id: existing.id, tenantId: existing.tenantId };
      const result = await client.query(
        `UPDATE scholarship_applications SET
           program_id = $3, applicant_id = $4, institution_id = $5, status = $6,
           academic_records = $7::jsonb, financial_info = $8::jsonb, documents = $9::jsonb,
           personal_statement = $10, area_id = $11, gender = $12, workflow_instance_id = $13,
           submitted_at = $14, reviewed_at = $15, reviewer_id = $16, review_notes = $17,
           updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          merged.programId,
          merged.applicantId,
          merged.institutionId,
          merged.status,
          JSON.stringify(merged.academicRecords ?? []),
          JSON.stringify(merged.financialInfo ?? {}),
          JSON.stringify(merged.documents ?? []),
          merged.personalStatement,
          merged.areaId,
          merged.gender,
          merged.workflowInstanceId,
          merged.submittedAt,
          merged.reviewedAt,
          merged.reviewerId ?? null,
          merged.reviewNotes ?? null,
        ],
      );
      if (!result.rows[0]) return null;
      return mapApplication(result.rows[0] as Record<string, unknown>);
    });
  }

  async findApplicationById(
    id: string,
    tenantId: string,
  ): Promise<ScholarshipApplicationEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM scholarship_applications WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapApplication(result.rows[0] as Record<string, unknown>);
    });
  }

  async listApplications(
    tenantId: string,
    filter: ApplicationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipApplicationEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const conditions = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      const add = (clause: string, value: unknown) => {
        params.push(value);
        conditions.push(clause.replace('?', `$${params.length}`));
      };
      if (filter.programId) add('program_id = ?', filter.programId);
      if (filter.applicantId) add('applicant_id = ?', filter.applicantId);
      if (filter.applicantIds) add('applicant_id = ANY(?)', filter.applicantIds);
      if (filter.institutionId) add('institution_id = ?', filter.institutionId);
      if (filter.status) add('status = ?', filter.status);
      if (filter.areaId) add('area_id = ?', filter.areaId);
      if (filter.gender) add('gender = ?', filter.gender);
      const where = conditions.join(' AND ');
      const countResult = await client.query(
        `SELECT count(*)::int AS c FROM scholarship_applications WHERE ${where}`,
        params,
      );
      const totalItems = Number((countResult.rows[0] as { c: number }).c);
      const offset = (pagination.page - 1) * pagination.pageSize;
      params.push(pagination.pageSize, offset);
      const result = await client.query(
        `SELECT * FROM scholarship_applications WHERE ${where}
         ${orderByClause(APPLICATION_SORT_COLUMNS, pagination, { column: 'created_at', order: 'desc' })}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapApplication(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  /**
   * PRC-H083: one withPgTenant transaction. Locks the application row, then
   * claims a slot with a conditional UPDATE (used_slots < total_slots) and
   * flips status with a status-guarded UPDATE, inserting the first instalment
   * last. Any throw rolls every step back.
   */
  async approveApplicationAtomic(
    id: string,
    tenantId: string,
    command: ApproveApplicationCommand,
  ): Promise<ApproveApplicationOutcome> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const appResult = await client.query(
        `SELECT * FROM scholarship_applications WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      const appRow = appResult.rows[0] as Record<string, unknown> | undefined;
      if (!appRow) return { kind: 'application_not_found' } as const;
      const application = mapApplication(appRow);
      if (!APPROVABLE_APPLICATION_STATUSES.includes(application.status)) {
        return { kind: 'invalid_status', status: application.status } as const;
      }

      const slotResult = await client.query(
        `UPDATE scholarship_programs
            SET used_slots = used_slots + 1, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND used_slots < total_slots
          RETURNING *`,
        [application.programId, tenantId],
      );
      const programRow = slotResult.rows[0] as Record<string, unknown> | undefined;
      if (!programRow) {
        const exists = await client.query(
          `SELECT 1 FROM scholarship_programs WHERE id = $1 AND tenant_id = $2`,
          [application.programId, tenantId],
        );
        return exists.rows[0]
          ? ({ kind: 'no_slots' } as const)
          : ({ kind: 'program_not_found' } as const);
      }
      const program = mapProgram(programRow);

      const updatedApp = await client.query(
        `UPDATE scholarship_applications
            SET status = 'approved', reviewed_at = $3, reviewer_id = $4, review_notes = $5,
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND status = ANY($6::text[])
          RETURNING *`,
        [
          id,
          tenantId,
          command.reviewedAt,
          command.reviewerId,
          command.reviewNotes,
          [...APPROVABLE_APPLICATION_STATUSES],
        ],
      );
      if (!updatedApp.rows[0]) {
        // Row is locked above, so this is unreachable unless RLS hides it;
        // throw so the slot claim is rolled back.
        throw new Error('scholarship approval lost its application row lock');
      }

      let disbursement: DisbursementEntity | null = null;
      if (command.firstDisbursement) {
        const inserted = await client.query(
          `INSERT INTO scholarship_disbursements (
             id, tenant_id, application_id, amount, amount_cents, scheduled_date,
             paid_date, payment_status, payment_method, transaction_reference, notes
           ) VALUES ($1,$2,$3,$4,$5,$6::date,NULL,'scheduled',NULL,NULL,$7) RETURNING *`,
          [
            command.firstDisbursement.id,
            tenantId,
            id,
            program.amountPerRecipient,
            program.amountPerRecipientCents,
            command.firstDisbursement.scheduledDate,
            command.firstDisbursement.notes,
          ],
        );
        disbursement = mapDisbursement(inserted.rows[0] as Record<string, unknown>);
      }

      return {
        kind: 'approved',
        application: mapApplication(updatedApp.rows[0] as Record<string, unknown>),
        program,
        disbursement,
      } as const;
    });
  }

  async countApplicationsByProgram(programId: string, tenantId: string): Promise<number> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT count(*)::int AS c FROM scholarship_applications
         WHERE program_id = $1 AND tenant_id = $2
           AND status NOT IN ('withdrawn', 'rejected')`,
        [programId, tenantId],
      );
      return Number((result.rows[0] as { c: number }).c);
    });
  }

  async findApplicationByApplicantAndProgram(
    applicantId: string,
    programId: string,
    tenantId: string,
  ): Promise<ScholarshipApplicationEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM scholarship_applications
         WHERE applicant_id = $1 AND program_id = $2 AND tenant_id = $3
           AND status <> 'withdrawn'
         LIMIT 1`,
        [applicantId, programId, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapApplication(result.rows[0] as Record<string, unknown>);
    });
  }

  async createDisbursement(
    data: Omit<DisbursementEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DisbursementEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO scholarship_disbursements (
           id, tenant_id, application_id, amount, amount_cents, scheduled_date, paid_date,
           payment_status, payment_method, transaction_reference, notes
         ) VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.applicationId,
          data.amount,
          data.amountCents,
          data.scheduledDate,
          data.paidDate,
          data.paymentStatus,
          data.paymentMethod,
          data.transactionReference,
          data.notes,
        ],
      );
      return mapDisbursement(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateDisbursement(
    id: string,
    tenantId: string,
    data: Partial<DisbursementEntity>,
    inTx?: (tx: ScholarshipTxClient) => Promise<void>,
  ): Promise<DisbursementEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existingResult = await client.query(
        `SELECT * FROM scholarship_disbursements WHERE id = $1 AND tenant_id = $2 LIMIT 1 FOR UPDATE`,
        [id, tenantId],
      );
      if (!existingResult.rows[0]) return null;
      const existing = mapDisbursement(existingResult.rows[0] as Record<string, unknown>);
      const merged = { ...existing, ...data, id: existing.id, tenantId: existing.tenantId };
      const result = await client.query(
        `UPDATE scholarship_disbursements SET
           application_id = $3, amount = $4, amount_cents = $5,
           scheduled_date = $6::date, paid_date = $7::date,
           payment_status = $8, payment_method = $9, transaction_reference = $10, notes = $11,
           updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          merged.applicationId,
          merged.amount,
          merged.amountCents,
          merged.scheduledDate,
          merged.paidDate,
          merged.paymentStatus,
          merged.paymentMethod,
          merged.transactionReference,
          merged.notes,
        ],
      );
      if (!result.rows[0]) return null;
      // PRC-H084: outbox row commits (or rolls back) with the status write.
      if (inTx) await inTx(client);
      return mapDisbursement(result.rows[0] as Record<string, unknown>);
    });
  }

  async findDisbursementById(id: string, tenantId: string): Promise<DisbursementEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM scholarship_disbursements WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapDisbursement(result.rows[0] as Record<string, unknown>);
    });
  }

  async listDisbursements(
    tenantId: string,
    filter: DisbursementFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DisbursementEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const conditions = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter.applicationId) {
        params.push(filter.applicationId);
        conditions.push(`application_id = $${params.length}`);
      }
      if (filter.paymentStatus) {
        params.push(filter.paymentStatus);
        conditions.push(`payment_status = $${params.length}`);
      }
      if (filter.scheduledDateFrom) {
        params.push(filter.scheduledDateFrom);
        conditions.push(`scheduled_date >= $${params.length}::date`);
      }
      if (filter.scheduledDateTo) {
        params.push(filter.scheduledDateTo);
        conditions.push(`scheduled_date <= $${params.length}::date`);
      }
      const where = conditions.join(' AND ');
      const countResult = await client.query(
        `SELECT count(*)::int AS c FROM scholarship_disbursements WHERE ${where}`,
        params,
      );
      const totalItems = Number((countResult.rows[0] as { c: number }).c);
      const offset = (pagination.page - 1) * pagination.pageSize;
      params.push(pagination.pageSize, offset);
      const result = await client.query(
        `SELECT * FROM scholarship_disbursements WHERE ${where}
         ${orderByClause(DISBURSEMENT_SORT_COLUMNS, pagination, { column: 'scheduled_date', order: 'asc' })}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapDisbursement(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  async listDisbursementsByApplication(
    applicationId: string,
    tenantId: string,
  ): Promise<DisbursementEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM scholarship_disbursements
         WHERE application_id = $1 AND tenant_id = $2
         ORDER BY scheduled_date ASC`,
        [applicationId, tenantId],
      );
      return result.rows.map((row) => mapDisbursement(row as Record<string, unknown>));
    });
  }

  async createComplianceRecord(
    data: Omit<ComplianceRecordEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ComplianceRecordEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO scholarship_compliance_records (
           id, tenant_id, application_id, compliance_type, status,
           evaluation_date, details, evaluator_id
         ) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.applicationId,
          data.complianceType,
          data.status,
          data.evaluationDate,
          data.details,
          data.evaluatorId,
        ],
      );
      return mapCompliance(result.rows[0] as Record<string, unknown>);
    });
  }

  async listComplianceRecords(
    applicationId: string,
    tenantId: string,
  ): Promise<ComplianceRecordEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM scholarship_compliance_records
         WHERE application_id = $1 AND tenant_id = $2
         ORDER BY evaluation_date DESC`,
        [applicationId, tenantId],
      );
      return result.rows.map((row) => mapCompliance(row as Record<string, unknown>));
    });
  }

  async getUtilizationReport(
    tenantId: string,
    filter: UtilizationReportFilter,
  ): Promise<UtilizationReportData> {
    await this.ensureSchema();
    // PRC-M352: aggregate in SQL (GROUP BY) instead of loading every programme,
    // application and disbursement into memory; honour startDate/endDate.
    const groupBy = filter.groupBy ?? 'program';
    const groupExpr = UTILIZATION_GROUP_EXPR[groupBy] ?? UTILIZATION_GROUP_EXPR.program;
    return this.withTenant(tenantId, async (client) => {
      const programsResult = await client.query(
        `SELECT count(*)::int AS c FROM scholarship_programs WHERE tenant_id = $1`,
        [tenantId],
      );
      const totalPrograms = Number((programsResult.rows[0] as { c: number } | undefined)?.c ?? 0);

      const appConditions = ['a.tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter.programId) {
        params.push(filter.programId);
        appConditions.push(`a.program_id = $${params.length}`);
      }
      if (filter.areaId) {
        params.push(filter.areaId);
        appConditions.push(`a.area_id = $${params.length}`);
      }
      if (filter.gender) {
        params.push(filter.gender);
        appConditions.push(`a.gender = $${params.length}`);
      }
      if (filter.institutionId) {
        params.push(filter.institutionId);
        appConditions.push(`a.institution_id = $${params.length}`);
      }
      const baseParamCount = params.length;
      // Applications are in-period by submission date.
      const appDateConditions: string[] = [];
      const appParams = [...params];
      if (filter.startDate) {
        appParams.push(filter.startDate);
        appDateConditions.push(`a.submitted_at::date >= $${appParams.length}::date`);
      }
      if (filter.endDate) {
        appParams.push(filter.endDate);
        appDateConditions.push(`a.submitted_at::date <= $${appParams.length}::date`);
      }
      const appsResult = await client.query(
        `SELECT ${groupExpr} AS group_value,
                count(*)::int AS application_count,
                (count(*) FILTER (WHERE a.status = 'approved'))::int AS approved_count
           FROM scholarship_applications a
          WHERE ${[...appConditions, ...appDateConditions].join(' AND ')}
          GROUP BY 1`,
        appParams,
      );

      // Disbursements are in-period by paid date (falling back to scheduled date).
      const disbParams = params.slice(0, baseParamCount);
      const disbDateConditions: string[] = [];
      if (filter.startDate) {
        disbParams.push(filter.startDate);
        disbDateConditions.push(
          `COALESCE(d.paid_date, d.scheduled_date) >= $${disbParams.length}::date`,
        );
      }
      if (filter.endDate) {
        disbParams.push(filter.endDate);
        disbDateConditions.push(
          `COALESCE(d.paid_date, d.scheduled_date) <= $${disbParams.length}::date`,
        );
      }
      const disbResult = await client.query(
        `SELECT ${groupExpr} AS group_value,
                p.currency AS currency,
                count(*)::int AS disbursed_count,
                COALESCE(sum(COALESCE(d.amount_cents, round(d.amount * 100))), 0)::bigint AS amount_cents
           FROM scholarship_disbursements d
           JOIN scholarship_applications a
             ON a.id = d.application_id AND a.tenant_id = d.tenant_id
           JOIN scholarship_programs p
             ON p.id = a.program_id AND p.tenant_id = a.tenant_id
          WHERE d.tenant_id = $1
            AND d.payment_status = 'paid'
            AND a.status = 'approved'
            ${[...appConditions.slice(1), ...disbDateConditions].map((c) => `AND ${c}`).join(' ')}
          GROUP BY 1, 2`,
        disbParams,
      );

      return buildUtilizationReport(
        groupBy,
        totalPrograms,
        appsResult.rows.map((r) => {
          const row = r as Record<string, unknown>;
          return {
            groupValue: String(row.group_value),
            applicationCount: Number(row.application_count),
            approvedCount: Number(row.approved_count),
          };
        }),
        disbResult.rows.map((r) => {
          const row = r as Record<string, unknown>;
          return {
            groupValue: String(row.group_value),
            currency: String(row.currency),
            disbursedCount: Number(row.disbursed_count),
            amountCents: Number(row.amount_cents),
          };
        }),
      );
    });
  }
}
