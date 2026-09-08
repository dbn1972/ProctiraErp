/**
 * Postgres special-needs store (G-203): assessments, diagnoses, referrals,
 * accommodation plans + PHI access log. Uses withPgTenant for RLS.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { withPgTenant, type PgQueryable } from '@proctira/database';

import type {
  AccommodationItem,
  AccommodationPlanEntity,
  DiagnosisEntity,
  ReferralEntity,
  SpecialNeedsAssessmentEntity,
} from './health-repository.js';
import {
  getSharedCounsellingPool,
  isPgCounsellingEnabled,
  type PgPoolLike,
} from './pg-counselling-store.js';
import { decryptPhi, encryptPhi } from './phi-crypto.js';

let schemaReady: Promise<void> | null = null;

export function isPgSpecialNeedsEnabled(): boolean {
  return isPgCounsellingEnabled();
}

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/017_health_special_needs_schema.sql'),
    join(process.cwd(), 'db/sql/017_health_special_needs_schema.sql'),
    join(process.cwd(), '../../db/sql/017_health_special_needs_schema.sql'),
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

export async function ensureSpecialNeedsSchema(
  pool: PgPoolLike = getSharedCounsellingPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for special-needs schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = readFileSync(schemaSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await schemaReady;
}

function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toDateOrNull(value: unknown): string | null {
  if (value == null) return null;
  return toDateStr(value);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function paginate<T>(items: T[], pagination: PaginationOptions): PaginatedResult<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
  const start = (pagination.page - 1) * pagination.pageSize;
  return {
    data: items.slice(start, start + pagination.pageSize),
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems,
      totalPages,
    },
  };
}

function parseAccommodations(value: unknown): AccommodationItem[] {
  if (value == null) return [];
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as AccommodationItem[];
    } catch {
      return [];
    }
  }
  return value as AccommodationItem[];
}

function mapAssessment(row: Record<string, unknown>): SpecialNeedsAssessmentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    assessmentDate: toDateStr(row.assessment_date),
    assessorName: String(row.assessor_name),
    assessorRole: String(row.assessor_role),
    assessmentType: String(row.assessment_type),
    findings: decryptPhi(String(row.findings)) ?? '',
    recommendations: decryptPhi(row.recommendations == null ? null : String(row.recommendations)),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapDiagnosis(row: Record<string, unknown>): DiagnosisEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    assessmentId: row.assessment_id == null ? null : String(row.assessment_id),
    diagnosisDate: toDateStr(row.diagnosis_date),
    diagnosedBy: String(row.diagnosed_by),
    condition: String(row.condition),
    category: String(row.category),
    severity: String(row.severity),
    notes: decryptPhi(row.notes == null ? null : String(row.notes)),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapReferral(row: Record<string, unknown>): ReferralEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    diagnosisId: row.diagnosis_id == null ? null : String(row.diagnosis_id),
    referralDate: toDateStr(row.referral_date),
    referredBy: String(row.referred_by),
    referredTo: String(row.referred_to),
    reason: decryptPhi(String(row.reason)) ?? '',
    status: String(row.status),
    appointmentDate: toDateOrNull(row.appointment_date),
    outcome: decryptPhi(row.outcome == null ? null : String(row.outcome)),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapPlan(row: Record<string, unknown>): AccommodationPlanEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    diagnosisId: row.diagnosis_id == null ? null : String(row.diagnosis_id),
    planName: String(row.plan_name),
    startDate: toDateStr(row.start_date),
    endDate: toDateOrNull(row.end_date),
    accommodations: parseAccommodations(row.accommodations),
    reviewDate: toDateOrNull(row.review_date),
    status: String(row.status),
    notes: decryptPhi(row.notes == null ? null : String(row.notes)),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export interface PhiAccessLogInput {
  tenantId: string;
  actorUserId: string;
  studentId: string;
  resourceType: string;
  resourceId?: string | null;
}

export class PgSpecialNeedsStore {
  constructor(private readonly pool: PgPoolLike) {}

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async ensureSchema(): Promise<void> {
    await ensureSpecialNeedsSchema(this.pool);
  }

  async logPhiAccess(input: PhiAccessLogInput): Promise<void> {
    await this.ensureSchema();
    await this.withTenant(input.tenantId, async (client) => {
      await client.query(
        `INSERT INTO health_phi_access_log
           (id, tenant_id, actor_user_id, student_id, resource_type, resource_id, action, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'READ', NOW())`,
        [
          randomUUID(),
          input.tenantId,
          input.actorUserId,
          input.studentId,
          input.resourceType,
          input.resourceId ?? null,
        ],
      );
    });
  }

  async createAssessment(
    data: Omit<SpecialNeedsAssessmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SpecialNeedsAssessmentEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO health_special_needs_assessments
           (id, tenant_id, student_id, assessment_date, assessor_name, assessor_role,
            assessment_type, findings, recommendations, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.assessmentDate,
          data.assessorName,
          data.assessorRole,
          data.assessmentType,
          encryptPhi(data.findings),
          encryptPhi(data.recommendations),
        ],
      );
      return mapAssessment((result.rows as Record<string, unknown>[])[0]!);
    });
  }

  async findAssessmentById(
    id: string,
    tenantId: string,
  ): Promise<SpecialNeedsAssessmentEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM health_special_needs_assessments WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = (result.rows as Record<string, unknown>[])[0];
      return row ? mapAssessment(row) : null;
    });
  }

  async listAssessmentsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SpecialNeedsAssessmentEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM health_special_needs_assessments
         WHERE tenant_id = $1 AND student_id = $2
         ORDER BY assessment_date DESC`,
        [tenantId, studentId],
      );
      return paginate(
        (result.rows as Record<string, unknown>[]).map(mapAssessment),
        pagination,
      );
    });
  }

  async createDiagnosis(
    data: Omit<DiagnosisEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DiagnosisEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO health_diagnoses
           (id, tenant_id, student_id, assessment_id, diagnosis_date, diagnosed_by,
            condition, category, severity, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.assessmentId,
          data.diagnosisDate,
          data.diagnosedBy,
          data.condition,
          data.category,
          data.severity,
          encryptPhi(data.notes),
        ],
      );
      return mapDiagnosis((result.rows as Record<string, unknown>[])[0]!);
    });
  }

  async findDiagnosisById(id: string, tenantId: string): Promise<DiagnosisEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM health_diagnoses WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = (result.rows as Record<string, unknown>[])[0];
      return row ? mapDiagnosis(row) : null;
    });
  }

  async listDiagnosesByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DiagnosisEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM health_diagnoses
         WHERE tenant_id = $1 AND student_id = $2
         ORDER BY diagnosis_date DESC`,
        [tenantId, studentId],
      );
      return paginate((result.rows as Record<string, unknown>[]).map(mapDiagnosis), pagination);
    });
  }

  async createReferral(
    data: Omit<ReferralEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ReferralEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO health_referrals
           (id, tenant_id, student_id, diagnosis_id, referral_date, referred_by, referred_to,
            reason, status, appointment_date, outcome, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.diagnosisId,
          data.referralDate,
          data.referredBy,
          data.referredTo,
          encryptPhi(data.reason),
          data.status,
          data.appointmentDate,
          encryptPhi(data.outcome),
        ],
      );
      return mapReferral((result.rows as Record<string, unknown>[])[0]!);
    });
  }

  async updateReferral(
    id: string,
    tenantId: string,
    data: Partial<ReferralEntity>,
  ): Promise<ReferralEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM health_referrals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = (existing.rows as Record<string, unknown>[])[0];
      if (!row) return null;
      const current = mapReferral(row);
      const next: ReferralEntity = {
        ...current,
        ...data,
        id: current.id,
        tenantId: current.tenantId,
        studentId: current.studentId,
        createdAt: current.createdAt,
        updatedAt: new Date(),
      };
      const result = await client.query(
        `UPDATE health_referrals SET
           diagnosis_id = $3, referral_date = $4, referred_by = $5, referred_to = $6,
           reason = $7, status = $8, appointment_date = $9, outcome = $10, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          next.diagnosisId,
          next.referralDate,
          next.referredBy,
          next.referredTo,
          encryptPhi(next.reason),
          next.status,
          next.appointmentDate,
          encryptPhi(next.outcome),
        ],
      );
      return mapReferral((result.rows as Record<string, unknown>[])[0]!);
    });
  }

  async findReferralById(id: string, tenantId: string): Promise<ReferralEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM health_referrals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = (result.rows as Record<string, unknown>[])[0];
      return row ? mapReferral(row) : null;
    });
  }

  async listReferralsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ReferralEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM health_referrals
         WHERE tenant_id = $1 AND student_id = $2
         ORDER BY referral_date DESC`,
        [tenantId, studentId],
      );
      return paginate((result.rows as Record<string, unknown>[]).map(mapReferral), pagination);
    });
  }

  async createAccommodationPlan(
    data: Omit<AccommodationPlanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AccommodationPlanEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO health_accommodation_plans
           (id, tenant_id, student_id, diagnosis_id, plan_name, start_date, end_date,
            accommodations, review_date, status, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,NOW(),NOW())
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.diagnosisId,
          data.planName,
          data.startDate,
          data.endDate,
          JSON.stringify(data.accommodations),
          data.reviewDate,
          data.status,
          encryptPhi(data.notes),
        ],
      );
      return mapPlan((result.rows as Record<string, unknown>[])[0]!);
    });
  }

  async updateAccommodationPlan(
    id: string,
    tenantId: string,
    data: Partial<AccommodationPlanEntity>,
  ): Promise<AccommodationPlanEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM health_accommodation_plans WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = (existing.rows as Record<string, unknown>[])[0];
      if (!row) return null;
      const current = mapPlan(row);
      const next: AccommodationPlanEntity = {
        ...current,
        ...data,
        id: current.id,
        tenantId: current.tenantId,
        studentId: current.studentId,
        createdAt: current.createdAt,
        updatedAt: new Date(),
      };
      const result = await client.query(
        `UPDATE health_accommodation_plans SET
           diagnosis_id = $3, plan_name = $4, start_date = $5, end_date = $6,
           accommodations = $7::jsonb, review_date = $8, status = $9, notes = $10, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          next.diagnosisId,
          next.planName,
          next.startDate,
          next.endDate,
          JSON.stringify(next.accommodations),
          next.reviewDate,
          next.status,
          encryptPhi(next.notes),
        ],
      );
      return mapPlan((result.rows as Record<string, unknown>[])[0]!);
    });
  }

  async findAccommodationPlanById(
    id: string,
    tenantId: string,
  ): Promise<AccommodationPlanEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM health_accommodation_plans WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = (result.rows as Record<string, unknown>[])[0];
      return row ? mapPlan(row) : null;
    });
  }

  async listAccommodationPlansByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AccommodationPlanEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM health_accommodation_plans
         WHERE tenant_id = $1 AND student_id = $2
         ORDER BY start_date DESC`,
        [tenantId, studentId],
      );
      return paginate((result.rows as Record<string, unknown>[]).map(mapPlan), pagination);
    });
  }
}

export function createPgSpecialNeedsStore(): PgSpecialNeedsStore | null {
  const pool = getSharedCounsellingPool();
  if (!pool) return null;
  return new PgSpecialNeedsStore(pool);
}
