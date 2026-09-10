/**
 * Postgres-backed student profile PHI + screening programs (raw `pg` — no Prisma).
 * Complements PgCounsellingStore for peer-gap Health PHI vault.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withPgTenant } from '@proctira/database';
import type pg from 'pg';

import type {
  AllergyEntity,
  HealthConditionEntity,
  HealthMeasurementEntity,
  InsuranceEntity,
  ScreeningProgramEntity,
  VaccinationEntity,
} from './health-repository.js';
import {
  getSharedCounsellingPool,
  isPgCounsellingEnabled,
  type PgPoolLike,
} from './pg-counselling-store.js';
import { decryptPhi, encryptPhi } from './phi-crypto.js';

let schemaReady: Promise<void> | null = null;

export function isPgPhiEnabled(): boolean {
  return isPgCounsellingEnabled();
}

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/012_health_screenings_profile_schema.sql'),
    join(process.cwd(), 'db/sql/012_health_screenings_profile_schema.sql'),
    join(process.cwd(), '../../db/sql/012_health_screenings_profile_schema.sql'),
  ];
  for (const p of candidates) {
    try {
      readFileSync(p, 'utf8');
      return p;
    } catch {
      // try next
    }
  }
  return candidates[0]!;
}

export async function ensurePhiSchema(
  pool: PgPoolLike = getSharedCounsellingPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for health PHI schema ensure');
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

function mapMeasurement(row: Record<string, unknown>): HealthMeasurementEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    date: toDateStr(row.measured_on),
    height: row.height == null ? null : Number(row.height),
    weight: row.weight == null ? null : Number(row.weight),
    bmi: row.bmi == null ? null : Number(row.bmi),
    bloodPressureSystolic:
      row.blood_pressure_systolic == null ? null : Number(row.blood_pressure_systolic),
    bloodPressureDiastolic:
      row.blood_pressure_diastolic == null ? null : Number(row.blood_pressure_diastolic),
    heartRate: row.heart_rate == null ? null : Number(row.heart_rate),
    visionLeft: row.vision_left == null ? null : String(row.vision_left),
    visionRight: row.vision_right == null ? null : String(row.vision_right),
    notes: decryptPhi(row.notes == null ? null : String(row.notes)),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAllergy(row: Record<string, unknown>): AllergyEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    allergyType: String(row.allergy_type),
    description: decryptPhi(String(row.description)) ?? '',
    severity: String(row.severity),
    reaction: decryptPhi(row.reaction == null ? null : String(row.reaction)),
    treatment: decryptPhi(row.treatment == null ? null : String(row.treatment)),
    diagnosedDate: toDateOrNull(row.diagnosed_date),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapCondition(row: Record<string, unknown>): HealthConditionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    conditionName: String(row.condition_name),
    conditionType: String(row.condition_type),
    diagnosedDate: toDateOrNull(row.diagnosed_date),
    status: String(row.status),
    treatment: decryptPhi(row.treatment == null ? null : String(row.treatment)),
    medication: decryptPhi(row.medication == null ? null : String(row.medication)),
    notes: decryptPhi(row.notes == null ? null : String(row.notes)),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapVaccination(row: Record<string, unknown>): VaccinationEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    vaccineName: String(row.vaccine_name),
    doseNumber: Number(row.dose_number),
    dateAdministered: toDateStr(row.date_administered),
    administeredBy: row.administered_by == null ? null : String(row.administered_by),
    batchNumber: row.batch_number == null ? null : String(row.batch_number),
    nextDueDate: toDateOrNull(row.next_due_date),
    notes: decryptPhi(row.notes == null ? null : String(row.notes)),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapInsurance(row: Record<string, unknown>): InsuranceEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    provider: String(row.provider),
    policyNumber: decryptPhi(String(row.policy_number)) ?? '',
    coverageType: String(row.coverage_type),
    startDate: toDateStr(row.start_date),
    endDate: toDateOrNull(row.end_date),
    notes: decryptPhi(row.notes == null ? null : String(row.notes)),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapScreening(row: Record<string, unknown>): ScreeningProgramEntity {
  const types = row.assessment_types;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    gradeLevel: String(row.grade_level),
    academicPeriodId: String(row.academic_period_id),
    assessmentTypes: Array.isArray(types) ? types.map(String) : [],
    scheduledDate: toDateOrNull(row.scheduled_date),
    status: String(row.status),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgPhiStore {
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
    await ensurePhiSchema(this.pool);
  }

  async createMeasurement(
    data: Omit<HealthMeasurementEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthMeasurementEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO health_measurements (
        id, tenant_id, student_id, measured_on, height, weight, bmi,
        blood_pressure_systolic, blood_pressure_diastolic, heart_rate,
        vision_left, vision_right, notes, created_at, updated_at
      ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.date,
        data.height,
        data.weight,
        data.bmi,
        data.bloodPressureSystolic,
        data.bloodPressureDiastolic,
        data.heartRate,
        data.visionLeft,
        data.visionRight,
        encryptPhi(data.notes),
        now,
        now,
      ],
    );
    return mapMeasurement(result.rows[0] as Record<string, unknown>);
  }

  async updateMeasurement(
    id: string,
    tenantId: string,
    data: Partial<HealthMeasurementEntity>,
  ): Promise<HealthMeasurementEntity | null> {
    await this.ensureSchema();
    const existing = await this.findMeasurementById(id, tenantId);
    if (!existing) return null;
    const merged: HealthMeasurementEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.query(
      tenantId,
      `UPDATE health_measurements SET
        measured_on=$3::date, height=$4, weight=$5, bmi=$6,
        blood_pressure_systolic=$7, blood_pressure_diastolic=$8, heart_rate=$9,
        vision_left=$10, vision_right=$11, notes=$12, updated_at=$13
      WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        id,
        tenantId,
        merged.date,
        merged.height,
        merged.weight,
        merged.bmi,
        merged.bloodPressureSystolic,
        merged.bloodPressureDiastolic,
        merged.heartRate,
        merged.visionLeft,
        merged.visionRight,
        encryptPhi(merged.notes),
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapMeasurement(result.rows[0] as Record<string, unknown>);
  }

  async findMeasurementById(id: string, tenantId: string): Promise<HealthMeasurementEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_measurements WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapMeasurement(result.rows[0] as Record<string, unknown>);
  }

  async listMeasurementsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthMeasurementEntity>> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_measurements WHERE tenant_id=$1 AND student_id=$2 ORDER BY measured_on DESC`,
      [tenantId, studentId],
    );
    return paginate(
      result.rows.map((r) => mapMeasurement(r as Record<string, unknown>)),
      pagination,
    );
  }

  async deleteMeasurement(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `DELETE FROM health_measurements WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createAllergy(
    data: Omit<AllergyEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AllergyEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO health_allergies (
        id, tenant_id, student_id, allergy_type, description, severity, reaction, treatment, diagnosed_date, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.allergyType,
        encryptPhi(data.description),
        data.severity,
        encryptPhi(data.reaction),
        encryptPhi(data.treatment),
        data.diagnosedDate,
        now,
        now,
      ],
    );
    return mapAllergy(result.rows[0] as Record<string, unknown>);
  }

  async updateAllergy(
    id: string,
    tenantId: string,
    data: Partial<AllergyEntity>,
  ): Promise<AllergyEntity | null> {
    await this.ensureSchema();
    const existing = await this.findAllergyById(id, tenantId);
    if (!existing) return null;
    const merged: AllergyEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.query(
      tenantId,
      `UPDATE health_allergies SET
        allergy_type=$3, description=$4, severity=$5, reaction=$6, treatment=$7,
        diagnosed_date=$8::date, updated_at=$9
      WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        id,
        tenantId,
        merged.allergyType,
        encryptPhi(merged.description),
        merged.severity,
        encryptPhi(merged.reaction),
        encryptPhi(merged.treatment),
        merged.diagnosedDate,
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapAllergy(result.rows[0] as Record<string, unknown>);
  }

  async findAllergyById(id: string, tenantId: string): Promise<AllergyEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_allergies WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapAllergy(result.rows[0] as Record<string, unknown>);
  }

  async listAllergiesByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AllergyEntity>> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_allergies WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at DESC`,
      [tenantId, studentId],
    );
    return paginate(
      result.rows.map((r) => mapAllergy(r as Record<string, unknown>)),
      pagination,
    );
  }

  /** G-912 — tenant-wide read for the `/health` records aggregate. */
  async listAllAllergies(tenantId: string): Promise<AllergyEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_allergies WHERE tenant_id=$1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((r) => mapAllergy(r as Record<string, unknown>));
  }

  async deleteAllergy(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `DELETE FROM health_allergies WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createCondition(
    data: Omit<HealthConditionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthConditionEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO health_conditions (
        id, tenant_id, student_id, condition_name, condition_type, diagnosed_date, status,
        treatment, medication, notes, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.conditionName,
        data.conditionType,
        data.diagnosedDate,
        data.status,
        encryptPhi(data.treatment),
        encryptPhi(data.medication),
        encryptPhi(data.notes),
        now,
        now,
      ],
    );
    return mapCondition(result.rows[0] as Record<string, unknown>);
  }

  async updateCondition(
    id: string,
    tenantId: string,
    data: Partial<HealthConditionEntity>,
  ): Promise<HealthConditionEntity | null> {
    await this.ensureSchema();
    const existing = await this.findConditionById(id, tenantId);
    if (!existing) return null;
    const merged: HealthConditionEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.query(
      tenantId,
      `UPDATE health_conditions SET
        condition_name=$3, condition_type=$4, diagnosed_date=$5::date, status=$6,
        treatment=$7, medication=$8, notes=$9, updated_at=$10
      WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        id,
        tenantId,
        merged.conditionName,
        merged.conditionType,
        merged.diagnosedDate,
        merged.status,
        encryptPhi(merged.treatment),
        encryptPhi(merged.medication),
        encryptPhi(merged.notes),
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapCondition(result.rows[0] as Record<string, unknown>);
  }

  async findConditionById(id: string, tenantId: string): Promise<HealthConditionEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_conditions WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapCondition(result.rows[0] as Record<string, unknown>);
  }

  async listConditionsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthConditionEntity>> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_conditions WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at DESC`,
      [tenantId, studentId],
    );
    return paginate(
      result.rows.map((r) => mapCondition(r as Record<string, unknown>)),
      pagination,
    );
  }

  /** G-912 — tenant-wide read for the `/health` records aggregate. */
  async listAllConditions(tenantId: string): Promise<HealthConditionEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_conditions WHERE tenant_id=$1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((r) => mapCondition(r as Record<string, unknown>));
  }

  async deleteCondition(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `DELETE FROM health_conditions WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createVaccination(
    data: Omit<VaccinationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<VaccinationEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO health_vaccinations (
        id, tenant_id, student_id, vaccine_name, dose_number, date_administered,
        administered_by, batch_number, next_due_date, notes, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9::date,$10,$11,$12) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.vaccineName,
        data.doseNumber,
        data.dateAdministered,
        data.administeredBy,
        data.batchNumber,
        data.nextDueDate,
        encryptPhi(data.notes),
        now,
        now,
      ],
    );
    return mapVaccination(result.rows[0] as Record<string, unknown>);
  }

  async updateVaccination(
    id: string,
    tenantId: string,
    data: Partial<VaccinationEntity>,
  ): Promise<VaccinationEntity | null> {
    await this.ensureSchema();
    const existing = await this.findVaccinationById(id, tenantId);
    if (!existing) return null;
    const merged: VaccinationEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.query(
      tenantId,
      `UPDATE health_vaccinations SET
        vaccine_name=$3, dose_number=$4, date_administered=$5::date, administered_by=$6,
        batch_number=$7, next_due_date=$8::date, notes=$9, updated_at=$10
      WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        id,
        tenantId,
        merged.vaccineName,
        merged.doseNumber,
        merged.dateAdministered,
        merged.administeredBy,
        merged.batchNumber,
        merged.nextDueDate,
        encryptPhi(merged.notes),
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapVaccination(result.rows[0] as Record<string, unknown>);
  }

  async findVaccinationById(id: string, tenantId: string): Promise<VaccinationEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_vaccinations WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapVaccination(result.rows[0] as Record<string, unknown>);
  }

  async listVaccinationsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<VaccinationEntity>> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_vaccinations WHERE tenant_id=$1 AND student_id=$2 ORDER BY date_administered DESC`,
      [tenantId, studentId],
    );
    return paginate(
      result.rows.map((r) => mapVaccination(r as Record<string, unknown>)),
      pagination,
    );
  }

  async deleteVaccination(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `DELETE FROM health_vaccinations WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createInsurance(
    data: Omit<InsuranceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<InsuranceEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO health_insurance (
        id, tenant_id, student_id, provider, policy_number, coverage_type, start_date, end_date, notes, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.provider,
        encryptPhi(data.policyNumber),
        data.coverageType,
        data.startDate,
        data.endDate,
        encryptPhi(data.notes),
        now,
        now,
      ],
    );
    return mapInsurance(result.rows[0] as Record<string, unknown>);
  }

  async updateInsurance(
    id: string,
    tenantId: string,
    data: Partial<InsuranceEntity>,
  ): Promise<InsuranceEntity | null> {
    await this.ensureSchema();
    const existing = await this.findInsuranceById(id, tenantId);
    if (!existing) return null;
    const merged: InsuranceEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.query(
      tenantId,
      `UPDATE health_insurance SET
        provider=$3, policy_number=$4, coverage_type=$5, start_date=$6::date,
        end_date=$7::date, notes=$8, updated_at=$9
      WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        id,
        tenantId,
        merged.provider,
        encryptPhi(merged.policyNumber),
        merged.coverageType,
        merged.startDate,
        merged.endDate,
        encryptPhi(merged.notes),
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapInsurance(result.rows[0] as Record<string, unknown>);
  }

  async findInsuranceById(id: string, tenantId: string): Promise<InsuranceEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_insurance WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapInsurance(result.rows[0] as Record<string, unknown>);
  }

  async listInsuranceByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InsuranceEntity>> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_insurance WHERE tenant_id=$1 AND student_id=$2 ORDER BY start_date DESC`,
      [tenantId, studentId],
    );
    return paginate(
      result.rows.map((r) => mapInsurance(r as Record<string, unknown>)),
      pagination,
    );
  }

  async deleteInsurance(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `DELETE FROM health_insurance WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createScreeningProgram(
    data: Omit<ScreeningProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScreeningProgramEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO health_screening_programs (
        id, tenant_id, name, description, grade_level, academic_period_id,
        assessment_types, scheduled_date, status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.name,
        data.description,
        data.gradeLevel,
        data.academicPeriodId,
        data.assessmentTypes,
        data.scheduledDate,
        data.status,
        now,
        now,
      ],
    );
    return mapScreening(result.rows[0] as Record<string, unknown>);
  }

  async updateScreeningProgram(
    id: string,
    tenantId: string,
    data: Partial<ScreeningProgramEntity>,
  ): Promise<ScreeningProgramEntity | null> {
    await this.ensureSchema();
    const existing = await this.findScreeningProgramById(id, tenantId);
    if (!existing) return null;
    const merged: ScreeningProgramEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.query(
      tenantId,
      `UPDATE health_screening_programs SET
        name=$3, description=$4, grade_level=$5, academic_period_id=$6,
        assessment_types=$7, scheduled_date=$8::date, status=$9, updated_at=$10
      WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        id,
        tenantId,
        merged.name,
        merged.description,
        merged.gradeLevel,
        merged.academicPeriodId,
        merged.assessmentTypes,
        merged.scheduledDate,
        merged.status,
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapScreening(result.rows[0] as Record<string, unknown>);
  }

  async findScreeningProgramById(
    id: string,
    tenantId: string,
  ): Promise<ScreeningProgramEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_screening_programs WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapScreening(result.rows[0] as Record<string, unknown>);
  }

  async listScreeningPrograms(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_screening_programs WHERE tenant_id=$1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return paginate(
      result.rows.map((r) => mapScreening(r as Record<string, unknown>)),
      pagination,
    );
  }

  async listScreeningProgramsByGrade(
    tenantId: string,
    gradeLevel: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_screening_programs WHERE tenant_id=$1 AND grade_level=$2 ORDER BY created_at DESC`,
      [tenantId, gradeLevel],
    );
    return paginate(
      result.rows.map((r) => mapScreening(r as Record<string, unknown>)),
      pagination,
    );
  }
}

export function createPgPhiStore(): PgPhiStore | null {
  const pool = getSharedCounsellingPool();
  if (!pool) return null;
  return new PgPhiStore(pool);
}
