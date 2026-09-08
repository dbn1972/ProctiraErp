/**
 * Postgres-backed registration / admissions CRM repository (raw `pg` — no Prisma).
 *
 * Persists the public apply pipeline against db/sql/014_admissions_crm_schema.sql
 * using withPgTenant for RLS (G-103 / G-205). Institution / form-config helpers
 * remain seedable in-memory overlays (same as gateway demo / unit tests).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';

import {
  haversineKm,
  type InMemoryInstitution,
} from './in-memory-repository.js';
import type {
  InstitutionLocationFilter,
  RegistrationEntity,
  RegistrationRepository,
  RegistrationStatus,
  SchoolFinderFilter,
  SchoolFinderResultRow,
} from './registration-repository.js';
import type { FormConfiguration, InstitutionLocation } from './schemas.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedRegistrationPool(): pg.Pool | null {
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
    join(here, '../../../../db/sql/014_admissions_crm_schema.sql'),
    join(process.cwd(), 'db/sql/014_admissions_crm_schema.sql'),
    join(process.cwd(), '../../db/sql/014_admissions_crm_schema.sql'),
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

export async function ensureRegistrationSchema(
  pool: PgPoolLike = getSharedRegistrationPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for registration schema ensure');
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
    submittedAt: toDate(row.submitted_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgRegistrationRepository implements RegistrationRepository {
  private institutions: InMemoryInstitution[] = [];
  private formConfigurations: FormConfiguration[] = [];

  constructor(private readonly pool: PgPoolLike) {}

  /** Seed institutions for testing / gateway demo overlays. */
  seedInstitutions(institutions: InMemoryInstitution[]): void {
    this.institutions = [...institutions];
  }

  /** Seed form configurations for testing. */
  seedFormConfigurations(configs: FormConfiguration[]): void {
    this.formConfigurations = [...configs];
  }

  async ensureSchema(): Promise<void> {
    await ensureRegistrationSchema(this.pool);
  }

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async create(
    entity: Omit<RegistrationEntity, 'submittedAt' | 'updatedAt'>,
  ): Promise<RegistrationEntity> {
    await this.ensureSchema();
    return this.withTenant(entity.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO admission_applications (
           id, tenant_id, tracking_number, institution_id, institution_name, status,
           first_name, last_name, date_of_birth, gender, guardian_name, guardian_phone,
           guardian_email, custom_fields, documents, preferred_language, remarks
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17
         ) RETURNING *`,
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
          JSON.stringify(entity.customFields ?? []),
          JSON.stringify(entity.documents ?? []),
          entity.preferredLanguage,
          entity.remarks,
        ],
      );
      return mapApplication(result.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Lookups bind the tenant GUC when a tenant is known: 021 FORCEs RLS, so an
   * unbound query returns nothing for the (owner) app role. Callers without a
   * tenant (legacy) still get the unbound query, which only works for
   * superuser connections.
   */
  async findByTrackingNumber(
    trackingNumber: string,
    tenantId?: string,
  ): Promise<RegistrationEntity | null> {
    await this.ensureSchema();
    const sql = `SELECT * FROM admission_applications WHERE tracking_number = $1 LIMIT 1`;
    const result = tenantId
      ? await this.withTenant(tenantId, (client) => client.query(sql, [trackingNumber]))
      : await this.pool.query(sql, [trackingNumber]);
    if (!result.rows[0]) return null;
    return mapApplication(result.rows[0] as Record<string, unknown>);
  }

  async findById(id: string, tenantId?: string): Promise<RegistrationEntity | null> {
    await this.ensureSchema();
    const sql = `SELECT * FROM admission_applications WHERE id = $1 LIMIT 1`;
    const result = tenantId
      ? await this.withTenant(tenantId, (client) => client.query(sql, [id]))
      : await this.pool.query(sql, [id]);
    if (!result.rows[0]) return null;
    return mapApplication(result.rows[0] as Record<string, unknown>);
  }

  async listByTenant(tenantId: string): Promise<RegistrationEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_applications
         WHERE tenant_id = $1
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
    await this.ensureSchema();
    const existing = await this.findById(id, tenantId);
    if (!existing) return null;
    return this.withTenant(existing.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE admission_applications
         SET status = $3,
             remarks = COALESCE($4, remarks),
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [id, existing.tenantId, status, remarks ?? null],
      );
      if (!result.rows[0]) return null;
      return mapApplication(result.rows[0] as Record<string, unknown>);
    });
  }

  async getFormConfiguration(institutionTypeId: string): Promise<FormConfiguration | null> {
    return this.formConfigurations.find((c) => c.institutionTypeId === institutionTypeId) ?? null;
  }

  async getInstitutionLocations(
    tenantId: string,
    filter: InstitutionLocationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionLocation>> {
    let filtered = this.institutions.filter(
      (i) => i.tenantId === tenantId && i.status === 'ACTIVE',
    );
    if (filter.areaId) filtered = filtered.filter((i) => i.areaId === filter.areaId);
    if (filter.typeId) filtered = filtered.filter((i) => i.typeId === filter.typeId);
    if (filter.gradeId) {
      filtered = filtered.filter((i) => i.availableGrades?.includes(filter.gradeId!) ?? false);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter((i) => i.name.toLowerCase().includes(searchLower));
    }
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize) || 1;
    const start = (pagination.page - 1) * pagination.pageSize;
    const paged = filtered.slice(start, start + pagination.pageSize);
    return {
      data: paged.map((i) => ({
        id: i.id,
        name: i.name,
        code: i.code,
        typeId: i.typeId,
        typeName: i.typeName,
        areaId: i.areaId,
        areaName: i.areaName,
        latitude: i.latitude,
        longitude: i.longitude,
        address: i.address,
        availableGrades: i.availableGrades,
      })),
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  async searchSchools(
    tenantId: string,
    filter: SchoolFinderFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SchoolFinderResultRow>> {
    let candidates = this.institutions.filter(
      (i) => i.tenantId === tenantId && i.status === 'ACTIVE',
    );
    if (filter.areaIds && filter.areaIds.length > 0) {
      const areaSet = new Set(filter.areaIds);
      candidates = candidates.filter((i) => areaSet.has(i.areaId));
    }
    if (filter.schoolTypes && filter.schoolTypes.length > 0) {
      const typeSet = new Set(filter.schoolTypes);
      candidates = candidates.filter((i) => typeSet.has(i.typeId));
    }
    if (filter.gradeLevels && filter.gradeLevels.length > 0) {
      const gradeSet = filter.gradeLevels;
      candidates = candidates.filter((i) =>
        (i.availableGrades ?? []).some((g) => gradeSet.includes(g)),
      );
    }
    if (filter.search && filter.search.trim().length > 0) {
      const needle = filter.search.toLowerCase();
      candidates = candidates.filter((i) => i.name.toLowerCase().includes(needle));
    }

    let scored: SchoolFinderResultRow[];
    if (filter.origin) {
      const { latitude: lat0, longitude: lon0, radiusKm } = filter.origin;
      scored = candidates
        .filter(
          (i): i is InMemoryInstitution & { latitude: number; longitude: number } =>
            i.latitude !== null && i.longitude !== null,
        )
        .map((i) => {
          const distance = haversineKm(lat0, lon0, i.latitude, i.longitude);
          return { row: this.toResultRow(i, distance), distance };
        })
        .filter((entry) => entry.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance)
        .map((entry) => entry.row);
    } else {
      scored = candidates
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => this.toResultRow(i));
    }

    const totalItems = scored.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
    const start = (pagination.page - 1) * pagination.pageSize;
    return {
      data: scored.slice(start, start + pagination.pageSize),
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  private toResultRow(inst: InMemoryInstitution, distanceKm?: number): SchoolFinderResultRow {
    const row: SchoolFinderResultRow = {
      id: inst.id,
      name: inst.name,
      code: inst.code,
      typeId: inst.typeId,
      areaId: inst.areaId,
      latitude: inst.latitude,
      longitude: inst.longitude,
    };
    if (inst.typeName !== undefined) row.typeName = inst.typeName;
    if (inst.areaName !== undefined) row.areaName = inst.areaName;
    if (inst.address !== undefined) row.address = inst.address;
    if (inst.availableGrades !== undefined) row.availableGrades = inst.availableGrades;
    if (distanceKm !== undefined) row.distanceKm = distanceKm;
    return row;
  }

  async getInstitutionName(institutionId: string): Promise<string | null> {
    return this.institutions.find((i) => i.id === institutionId)?.name ?? null;
  }

  async isInstitutionActive(institutionId: string): Promise<boolean> {
    return this.institutions.find((i) => i.id === institutionId)?.status === 'ACTIVE';
  }

  async getInstitutionTypeId(institutionId: string): Promise<string | null> {
    return this.institutions.find((i) => i.id === institutionId)?.typeId ?? null;
  }
}
