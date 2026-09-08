/**
 * Postgres-backed scholarship repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, programs / applications / disbursements persist via
 * db/sql/016_scholarships_schema.sql. Uses withPgTenant for RLS (G-103 / G-204).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';

import type {
  AcademicRecord,
  ApplicationDocument,
  EligibilityCriteria,
  FinancialInfo,
} from './schemas.js';
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
} from './scholarship-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedScholarshipPool(): pg.Pool | null {
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
    join(here, '../../../../db/sql/016_scholarships_schema.sql'),
    join(process.cwd(), 'db/sql/016_scholarships_schema.sql'),
    join(process.cwd(), '../../db/sql/016_scholarships_schema.sql'),
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

export async function ensureScholarshipSchema(
  pool: PgPoolLike = getSharedScholarshipPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for scholarship schema ensure');
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

function mapProgram(row: Record<string, unknown>): ScholarshipProgramEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    applicationStartDate: dateOnly(row.application_start_date),
    applicationEndDate: dateOnly(row.application_end_date),
    totalSlots: Number(row.total_slots),
    usedSlots: Number(row.used_slots),
    amountPerRecipient: Number(row.amount_per_recipient),
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
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapDisbursement(row: Record<string, unknown>): DisbursementEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    applicationId: String(row.application_id),
    amount: Number(row.amount),
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
           total_slots, used_slots, amount_per_recipient, currency, disbursement_frequency,
           eligibility, status, academic_period_id, funding_source_id
         ) VALUES (
           $1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15
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
           amount_per_recipient = $9, currency = $10, disbursement_frequency = $11,
           eligibility = $12::jsonb, status = $13, academic_period_id = $14,
           funding_source_id = $15, updated_at = now()
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
        params.push(`%${filter.search.toLowerCase()}%`);
        conditions.push(`lower(name) LIKE $${params.length}`);
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
         ORDER BY created_at DESC
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
           area_id, gender, workflow_instance_id, submitted_at, reviewed_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15
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
           submitted_at = $14, reviewed_at = $15, updated_at = now()
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
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapApplication(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
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
           id, tenant_id, application_id, amount, scheduled_date, paid_date,
           payment_status, payment_method, transaction_reference, notes
         ) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.applicationId,
          data.amount,
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
  ): Promise<DisbursementEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existingResult = await client.query(
        `SELECT * FROM scholarship_disbursements WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!existingResult.rows[0]) return null;
      const existing = mapDisbursement(existingResult.rows[0] as Record<string, unknown>);
      const merged = { ...existing, ...data, id: existing.id, tenantId: existing.tenantId };
      const result = await client.query(
        `UPDATE scholarship_disbursements SET
           application_id = $3, amount = $4, scheduled_date = $5::date, paid_date = $6::date,
           payment_status = $7, payment_method = $8, transaction_reference = $9, notes = $10,
           updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          merged.applicationId,
          merged.amount,
          merged.scheduledDate,
          merged.paidDate,
          merged.paymentStatus,
          merged.paymentMethod,
          merged.transactionReference,
          merged.notes,
        ],
      );
      if (!result.rows[0]) return null;
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
         ORDER BY scheduled_date ASC
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
    return this.withTenant(tenantId, async (client) => {
      const programsResult = await client.query(
        `SELECT * FROM scholarship_programs WHERE tenant_id = $1`,
        [tenantId],
      );
      const programs = programsResult.rows.map((row) => mapProgram(row as Record<string, unknown>));

      const appConditions = ['tenant_id = $1'];
      const appParams: unknown[] = [tenantId];
      if (filter.programId) {
        appParams.push(filter.programId);
        appConditions.push(`program_id = $${appParams.length}`);
      }
      if (filter.areaId) {
        appParams.push(filter.areaId);
        appConditions.push(`area_id = $${appParams.length}`);
      }
      if (filter.gender) {
        appParams.push(filter.gender);
        appConditions.push(`gender = $${appParams.length}`);
      }
      if (filter.institutionId) {
        appParams.push(filter.institutionId);
        appConditions.push(`institution_id = $${appParams.length}`);
      }
      const appsResult = await client.query(
        `SELECT * FROM scholarship_applications WHERE ${appConditions.join(' AND ')}`,
        appParams,
      );
      const apps = appsResult.rows.map((row) => mapApplication(row as Record<string, unknown>));

      const disbursementsResult = await client.query(
        `SELECT * FROM scholarship_disbursements WHERE tenant_id = $1`,
        [tenantId],
      );
      const disbursementsList = disbursementsResult.rows.map((row) =>
        mapDisbursement(row as Record<string, unknown>),
      );

      const approvedApps = apps.filter((a) => a.status === 'approved');
      const approvedAppIds = new Set(approvedApps.map((a) => a.id));
      const paidDisbursements = disbursementsList.filter(
        (d) => approvedAppIds.has(d.applicationId) && d.paymentStatus === 'paid',
      );
      const totalAmount = paidDisbursements.reduce((sum, d) => sum + d.amount, 0);
      const currency = programs.length > 0 && programs[0] ? programs[0].currency : 'USD';
      const groupBy = filter.groupBy ?? 'program';
      const groupMap = new Map<
        string,
        { applicationCount: number; approvedCount: number; disbursedAmount: number }
      >();

      const groupKeyFor = (app: ScholarshipApplicationEntity): string => {
        switch (groupBy) {
          case 'area':
            return app.areaId ?? 'unknown';
          case 'gender':
            return app.gender ?? 'unknown';
          case 'institution':
            return app.institutionId;
          case 'program':
          default:
            return app.programId;
        }
      };

      for (const app of apps) {
        const key = groupKeyFor(app);
        if (!groupMap.has(key)) {
          groupMap.set(key, { applicationCount: 0, approvedCount: 0, disbursedAmount: 0 });
        }
        const group = groupMap.get(key)!;
        group.applicationCount++;
        if (app.status === 'approved') group.approvedCount++;
      }

      const appById = new Map(apps.map((a) => [a.id, a]));
      for (const d of paidDisbursements) {
        const app = appById.get(d.applicationId);
        if (!app) continue;
        const group = groupMap.get(groupKeyFor(app));
        if (group) group.disbursedAmount += d.amount;
      }

      const breakdown = Array.from(groupMap.entries()).map(([key, data]) => ({
        groupKey: groupBy,
        groupValue: key,
        applicationCount: data.applicationCount,
        approvedCount: data.approvedCount,
        disbursedAmount: data.disbursedAmount,
        utilizationRate:
          data.applicationCount > 0
            ? Math.round((data.approvedCount / data.applicationCount) * 10000) / 100
            : 0,
      }));

      return {
        totalPrograms: programs.length,
        totalApplications: apps.length,
        totalApproved: approvedApps.length,
        totalDisbursed: paidDisbursements.length,
        totalAmount,
        currency,
        breakdown,
      };
    });
  }
}
