/**
 * PostgreSQL-backed public registration repository.
 *
 * Applications, authoritative institutions, published form configurations,
 * and idempotency records are read/written through tenant-bound transactions.
 */
import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import {
  createDatabaseSchemaReadinessCheck,
  getSharedPgPool,
  withPgTenant,
  type PgQueryable,
} from '@proctira/database';
import { Value } from '@sinclair/typebox/value';
import type pg from 'pg';

import { haversineKm } from './in-memory-repository.js';
import type {
  IdempotentRegistrationCreateResult,
  InstitutionLocationFilter,
  LegacyRegistrationCreate,
  NewRegistrationEntity,
  RegistrationEntity,
  RegistrationInstitution,
  RegistrationRepository,
  RegistrationStatus,
  SchoolFinderFilter,
  SchoolFinderResultRow,
} from './registration-repository.js';
import {
  FormConfigurationSchema,
  type FormConfiguration,
  type InstitutionLocation,
} from './schemas.js';

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

const ensureRegistrationSchemaReady = createDatabaseSchemaReadinessCheck(
  'registration',
  'registration',
);

export function getSharedRegistrationPool(): pg.Pool | null {
  return getSharedPgPool();
}

export async function ensureRegistrationSchema(
  pool: PgPoolLike = getSharedRegistrationPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for registration schema ensure');
  await ensureRegistrationSchemaReady(pool);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
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

function mapFormConfiguration(row: Record<string, unknown>): FormConfiguration {
  const configuration = {
    id: String(row.id),
    institutionId: String(row.institution_id),
    version: Number(row.version),
    publishedAt: toDate(row.published_at).toISOString(),
    fields: parseJson(row.fields, null),
  };
  if (!Value.Check(FormConfigurationSchema, configuration)) {
    throw new Error('Published registration form configuration is invalid');
  }
  return configuration;
}

function mapApplication(row: Record<string, unknown>): RegistrationEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    trackingNumber: String(row.tracking_number),
    institutionId: String(row.institution_id),
    institutionName: String(row.institution_name),
    status: String(row.status) as RegistrationStatus,
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    dateOfBirth: dateOnly(row.date_of_birth),
    gender: row.gender == null ? 'other' : String(row.gender),
    guardianName: String(row.guardian_name),
    guardianPhone: String(row.guardian_phone),
    guardianEmail: row.guardian_email == null ? null : String(row.guardian_email),
    customFields: parseJson(row.custom_fields, []),
    documents: parseJson(row.documents, []),
    preferredLanguage: row.preferred_language == null ? null : String(row.preferred_language),
    remarks: row.remarks == null ? null : String(row.remarks),
    formConfigurationId:
      row.form_configuration_id == null ? null : String(row.form_configuration_id),
    formConfigurationVersion:
      row.form_configuration_version == null ? null : Number(row.form_configuration_version),
    formConfigurationSnapshot: parseJson<FormConfiguration | null>(
      row.form_configuration_snapshot,
      null,
    ),
    submissionKey: row.submission_key == null ? null : String(row.submission_key),
    submissionPayloadHash:
      row.submission_payload_hash == null ? null : String(row.submission_payload_hash),
    submittedAt: toDate(row.submitted_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapInstitution(row: Record<string, unknown>): RegistrationInstitution {
  const grades = Array.isArray(row.available_grades)
    ? row.available_grades.map(String)
    : parseJson<string[]>(row.available_grades, []);
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    code: String(row.code),
    typeId: String(row.type_id),
    typeName: row.type_name == null ? undefined : String(row.type_name),
    areaId: String(row.area_id),
    areaName: row.area_name == null ? undefined : String(row.area_name),
    status: String(row.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    address: row.address == null ? null : String(row.address),
    availableGrades: grades,
  };
}

export class PgRegistrationRepository implements RegistrationRepository {
  constructor(private readonly pool: PgPoolLike) {}

  async ensureSchema(): Promise<void> {
    await ensureRegistrationSchema(this.pool);
  }

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async create(entity: LegacyRegistrationCreate): Promise<RegistrationEntity> {
    await this.ensureSchema();
    return this.withTenant(entity.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO admission_applications (
           id, tenant_id, tracking_number, institution_id, institution_name, status,
           first_name, last_name, date_of_birth, gender, guardian_name, guardian_phone,
           guardian_email, custom_fields, documents, preferred_language, remarks
         ) VALUES (
           $1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,
           $14::jsonb,$15::jsonb,$16,$17
         )
         RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.trackingNumber,
          entity.institutionId,
          entity.institutionName,
          entity.status,
          entity.firstName,
          entity.lastName,
          entity.dateOfBirth,
          entity.gender,
          entity.guardianName,
          entity.guardianPhone,
          entity.guardianEmail,
          JSON.stringify(entity.customFields),
          JSON.stringify(entity.documents),
          entity.preferredLanguage,
          entity.remarks,
        ],
      );
      return mapApplication(result.rows[0] as Record<string, unknown>);
    });
  }

  async createIdempotent(
    entity: NewRegistrationEntity,
  ): Promise<IdempotentRegistrationCreateResult> {
    await this.ensureSchema();
    return this.withTenant(entity.tenantId, async (client) => {
      const prior = await client.query(
        `SELECT *
           FROM admission_applications
          WHERE tenant_id = $1::uuid AND submission_key = $2
          LIMIT 1`,
        [entity.tenantId, entity.submissionKey],
      );
      if (prior.rows[0]) {
        const registration = mapApplication(prior.rows[0] as Record<string, unknown>);
        return registration.submissionPayloadHash === entity.submissionPayloadHash
          ? { outcome: 'replayed', registration }
          : { outcome: 'payload_conflict' };
      }

      const context = await client.query(
        `SELECT i.name AS institution_name, c.*
           FROM institutions i
           JOIN admission_form_configurations c
             ON c.tenant_id = i.tenant_id
            AND c.institution_id = i.id
          WHERE i.tenant_id = $1::uuid
            AND i.id = $2::uuid
            AND i.deleted_at IS NULL
            AND lower(i.status) = 'active'
            AND c.id = $3::uuid
            AND c.version = $4
          LIMIT 1
          FOR KEY SHARE OF i, c`,
        [
          entity.tenantId,
          entity.institutionId,
          entity.formConfigurationId,
          entity.formConfigurationVersion,
        ],
      );
      if (!context.rows[0]) return { outcome: 'context_unavailable' };

      const contextRow = context.rows[0] as Record<string, unknown>;
      const configuration = mapFormConfiguration(contextRow);
      const inserted = await client.query(
        `INSERT INTO admission_applications (
           id, tenant_id, tracking_number, institution_id, institution_name, status,
           first_name, last_name, date_of_birth, gender, guardian_name, guardian_phone,
           guardian_email, custom_fields, documents, preferred_language, remarks,
           form_configuration_id, form_configuration_version, form_configuration_snapshot,
           submission_key, submission_payload_hash
         ) VALUES (
           $1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,
           $14::jsonb,$15::jsonb,$16,$17,$18::uuid,$19,$20::jsonb,$21,$22
         )
         ON CONFLICT (tenant_id, submission_key) WHERE submission_key IS NOT NULL
         DO NOTHING
         RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.trackingNumber,
          entity.institutionId,
          String(contextRow.institution_name),
          entity.status,
          entity.firstName,
          entity.lastName,
          entity.dateOfBirth,
          entity.gender,
          entity.guardianName,
          entity.guardianPhone,
          entity.guardianEmail,
          JSON.stringify(entity.customFields),
          JSON.stringify(entity.documents),
          entity.preferredLanguage,
          entity.remarks,
          configuration.id,
          configuration.version,
          JSON.stringify(configuration),
          entity.submissionKey,
          entity.submissionPayloadHash,
        ],
      );
      if (inserted.rows[0]) {
        return {
          outcome: 'created',
          registration: mapApplication(inserted.rows[0] as Record<string, unknown>),
        };
      }

      // A concurrent transaction won the exact tenant/key unique index. The
      // unique-index conflict waits for that transaction before DO NOTHING,
      // so its committed row is visible to this statement sequence.
      const raced = await client.query(
        `SELECT *
           FROM admission_applications
          WHERE tenant_id = $1::uuid AND submission_key = $2
          LIMIT 1`,
        [entity.tenantId, entity.submissionKey],
      );
      if (!raced.rows[0]) {
        throw new Error('Idempotent application conflict completed without a durable result');
      }
      const registration = mapApplication(raced.rows[0] as Record<string, unknown>);
      return registration.submissionPayloadHash === entity.submissionPayloadHash
        ? { outcome: 'replayed', registration }
        : { outcome: 'payload_conflict' };
    });
  }

  async findByTrackingNumber(
    trackingNumber: string,
    tenantId?: string,
  ): Promise<RegistrationEntity | null> {
    const scopedTenantId = this.requireTenant(tenantId, 'findByTrackingNumber');
    await this.ensureSchema();
    const result = await this.withTenant(scopedTenantId, (client) =>
      client.query(
        `SELECT * FROM admission_applications
          WHERE tenant_id = $1::uuid AND tracking_number = $2
          LIMIT 1`,
        [scopedTenantId, trackingNumber],
      ),
    );
    return result.rows[0] ? mapApplication(result.rows[0] as Record<string, unknown>) : null;
  }

  async findById(id: string, tenantId?: string): Promise<RegistrationEntity | null> {
    const scopedTenantId = this.requireTenant(tenantId, 'findById');
    await this.ensureSchema();
    const result = await this.withTenant(scopedTenantId, (client) =>
      client.query(
        `SELECT * FROM admission_applications
          WHERE tenant_id = $1::uuid AND id = $2::uuid
          LIMIT 1`,
        [scopedTenantId, id],
      ),
    );
    return result.rows[0] ? mapApplication(result.rows[0] as Record<string, unknown>) : null;
  }

  async listByTenant(tenantId: string): Promise<RegistrationEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_applications
          WHERE tenant_id = $1::uuid
          ORDER BY submitted_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapApplication(row as Record<string, unknown>));
    });
  }

  async updateStatus(
    id: string,
    status: RegistrationStatus,
    remarks?: string,
    tenantId?: string,
  ): Promise<RegistrationEntity | null> {
    const scopedTenantId = this.requireTenant(tenantId, 'updateStatus');
    await this.ensureSchema();
    const result = await this.withTenant(scopedTenantId, (client) =>
      client.query(
        `UPDATE admission_applications
            SET status = $3,
                remarks = COALESCE($4, remarks),
                updated_at = now()
          WHERE tenant_id = $1::uuid AND id = $2::uuid
          RETURNING *`,
        [scopedTenantId, id, status, remarks ?? null],
      ),
    );
    return result.rows[0] ? mapApplication(result.rows[0] as Record<string, unknown>) : null;
  }

  async getFormConfiguration(
    tenantId: string,
    institutionId: string,
    configurationId?: string,
  ): Promise<FormConfiguration | null> {
    await this.ensureSchema();
    const result = await this.withTenant(tenantId, (client) =>
      client.query(
        `SELECT c.*
           FROM admission_form_configurations c
           JOIN institutions i
             ON i.tenant_id = c.tenant_id
            AND i.id = c.institution_id
          WHERE c.tenant_id = $1::uuid
            AND c.institution_id = $2::uuid
            AND ($3::uuid IS NULL OR c.id = $3::uuid)
            AND i.deleted_at IS NULL
            AND lower(i.status) = 'active'
          ORDER BY c.version DESC
          LIMIT 1`,
        [tenantId, institutionId, configurationId ?? null],
      ),
    );
    return result.rows[0] ? mapFormConfiguration(result.rows[0] as Record<string, unknown>) : null;
  }

  async findInstitution(
    tenantId: string,
    institutionId: string,
  ): Promise<RegistrationInstitution | null> {
    const rows = await this.loadInstitutions(tenantId, institutionId);
    return rows[0] ?? null;
  }

  async getInstitutionLocations(
    tenantId: string,
    filter: InstitutionLocationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionLocation>> {
    let rows = (await this.loadInstitutions(tenantId)).filter((row) => row.status === 'ACTIVE');
    if (filter.areaId) rows = rows.filter((row) => row.areaId === filter.areaId);
    if (filter.typeId) rows = rows.filter((row) => row.typeId === filter.typeId);
    if (filter.gradeId) {
      rows = rows.filter((row) => row.availableGrades?.includes(filter.gradeId!) ?? false);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      rows = rows.filter(
        (row) =>
          row.name.toLowerCase().includes(search) ||
          row.code.toLowerCase().includes(search) ||
          row.areaName?.toLowerCase().includes(search),
      );
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return this.paginateLocations(rows, pagination);
  }

  async searchSchools(
    tenantId: string,
    filter: SchoolFinderFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SchoolFinderResultRow>> {
    let candidates = (await this.loadInstitutions(tenantId)).filter(
      (row) => row.status === 'ACTIVE',
    );
    if (filter.areaIds?.length) {
      const values = new Set(filter.areaIds);
      candidates = candidates.filter((row) => values.has(row.areaId));
    }
    if (filter.schoolTypes?.length) {
      const values = new Set(filter.schoolTypes);
      candidates = candidates.filter((row) => values.has(row.typeId));
    }
    if (filter.gradeLevels?.length) {
      candidates = candidates.filter((row) =>
        (row.availableGrades ?? []).some((grade) => filter.gradeLevels!.includes(grade)),
      );
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      candidates = candidates.filter((row) => row.name.toLowerCase().includes(search));
    }

    let rows: SchoolFinderResultRow[];
    if (filter.origin) {
      const { latitude, longitude, radiusKm } = filter.origin;
      rows = candidates
        .filter(
          (row): row is RegistrationInstitution & { latitude: number; longitude: number } =>
            row.latitude !== null && row.longitude !== null,
        )
        .map((row) => ({
          row: this.toSchoolResult(
            row,
            haversineKm(latitude, longitude, row.latitude, row.longitude),
          ),
          distance: haversineKm(latitude, longitude, row.latitude, row.longitude),
        }))
        .filter(({ distance }) => distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance)
        .map(({ row }) => row);
    } else {
      rows = candidates
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => this.toSchoolResult(row));
    }

    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
    const start = (pagination.page - 1) * pagination.pageSize;
    return {
      data: rows.slice(start, start + pagination.pageSize),
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  private requireTenant(tenantId: string | undefined, operation: string): string {
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      throw new Error(`${operation}: tenantId is required`);
    }
    return tenantId;
  }

  private async loadInstitutions(
    tenantId: string,
    institutionId?: string,
  ): Promise<RegistrationInstitution[]> {
    await this.ensureSchema();
    const result = await this.withTenant(tenantId, (client) =>
      client.query(
        `SELECT
           i.id,
           i.tenant_id,
           i.name,
           i.code,
           i.type AS type_id,
           i.type AS type_name,
           i.area_id,
           a.name AS area_name,
           i.status,
           CASE
             WHEN i.custom_data->'__profile'->>'latitude' ~ '^-?[0-9]+(\\.[0-9]+)?$'
             THEN (i.custom_data->'__profile'->>'latitude')::double precision
             ELSE NULL
           END AS latitude,
           CASE
             WHEN i.custom_data->'__profile'->>'longitude' ~ '^-?[0-9]+(\\.[0-9]+)?$'
             THEN (i.custom_data->'__profile'->>'longitude')::double precision
             ELSE NULL
           END AS longitude,
           i.custom_data->'__profile'->>'address' AS address,
           COALESCE(
             array_agg(DISTINCT c.grade_id::text) FILTER (WHERE c.grade_id IS NOT NULL),
             ARRAY[]::text[]
           ) AS available_grades
         FROM institutions i
         LEFT JOIN geographic_areas a
           ON a.tenant_id = i.tenant_id
          AND a.id = i.area_id
          AND a.deleted_at IS NULL
         LEFT JOIN classes c
           ON c.tenant_id = i.tenant_id
          AND c.institution_id = i.id
          AND c.deleted_at IS NULL
         WHERE i.tenant_id = $1::uuid
           AND i.deleted_at IS NULL
           AND ($2::uuid IS NULL OR i.id = $2::uuid)
         GROUP BY i.id, a.id, a.name
         ORDER BY i.name, i.id`,
        [tenantId, institutionId ?? null],
      ),
    );
    return result.rows.map((row) => mapInstitution(row as Record<string, unknown>));
  }

  private paginateLocations(
    rows: RegistrationInstitution[],
    pagination: PaginationOptions,
  ): PaginatedResult<InstitutionLocation> {
    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
    const start = (pagination.page - 1) * pagination.pageSize;
    return {
      data: rows
        .slice(start, start + pagination.pageSize)
        .map(({ tenantId: _tenantId, status: _status, ...row }) => row),
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  private toSchoolResult(
    institution: RegistrationInstitution,
    distanceKm?: number,
  ): SchoolFinderResultRow {
    const { tenantId: _tenantId, status: _status, ...row } = institution;
    return { ...row, ...(distanceKm === undefined ? {} : { distanceKm }) };
  }
}
