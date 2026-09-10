/**
 * Postgres-backed staff HR store (raw `pg` — db/sql/043_staff_hr_schema.sql).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';

import type {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffContractRecord,
  StaffContractStatus,
  StaffContractType,
  StaffHrStore,
  StaffQualificationRecord,
} from './hr-store.js';

export type PgHrOpsPool = PgQueryable & { connect?: unknown };

let schemaReady: Promise<void> | null = null;

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const name = '043_staff_hr_schema.sql';
  const roots = [
    join(here, '../../../../db/sql'),
    join(process.cwd(), 'db/sql'),
    join(process.cwd(), '../../db/sql'),
  ];
  for (const root of roots) {
    const path = join(root, name);
    try {
      readFileSync(path, 'utf8');
      return path;
    } catch {
      // try next
    }
  }
  return join(roots[0]!, name);
}

export async function ensureStaffHrSchema(pool: PgHrOpsPool): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(readFileSync(schemaSqlPath(), 'utf8'));
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapContract(row: Record<string, unknown>): StaffContractRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    staffId: String(row.staff_id),
    contractType: String(row.contract_type) as StaffContractType,
    startDate: toDateStr(row.start_date),
    endDate: row.end_date == null ? null : toDateStr(row.end_date),
    salaryBand: String(row.salary_band ?? ''),
    status: String(row.status) as StaffContractStatus,
    notes: row.notes == null ? null : String(row.notes),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapQualification(row: Record<string, unknown>): StaffQualificationRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    staffId: String(row.staff_id),
    degree: String(row.degree),
    institution: String(row.institution),
    year: Number(row.year),
    verified: Boolean(row.verified),
    documentRef: row.document_ref == null ? null : String(row.document_ref),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAttendance(row: Record<string, unknown>): StaffAttendanceRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    staffId: String(row.staff_id),
    date: toDateStr(row.attendance_date),
    status: String(row.status) as StaffAttendanceStatus,
    notes: row.notes == null ? null : String(row.notes),
    markedBy: row.marked_by == null ? null : String(row.marked_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgStaffHrStore implements StaffHrStore {
  constructor(private readonly pool: PgHrOpsPool) {}

  private run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  async createContract(record: StaffContractRecord): Promise<StaffContractRecord> {
    await ensureStaffHrSchema(this.pool);
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO staff_contracts (
           id, tenant_id, staff_id, contract_type, start_date, end_date, salary_band, status, notes, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.staffId,
          record.contractType,
          record.startDate,
          record.endDate,
          record.salaryBand,
          record.status,
          record.notes,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapContract(rows[0] as Record<string, unknown>);
    });
  }

  async listContracts(tenantId: string, staffId?: string): Promise<StaffContractRecord[]> {
    await ensureStaffHrSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = staffId
        ? await client.query(
            `SELECT * FROM staff_contracts WHERE tenant_id = $1 AND staff_id = $2 ORDER BY start_date DESC`,
            [tenantId, staffId],
          )
        : await client.query(
            `SELECT * FROM staff_contracts WHERE tenant_id = $1 ORDER BY start_date DESC`,
            [tenantId],
          );
      return rows.map((row) => mapContract(row as Record<string, unknown>));
    });
  }

  async findContract(tenantId: string, id: string): Promise<StaffContractRecord | null> {
    await ensureStaffHrSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM staff_contracts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!rows[0]) return null;
      return mapContract(rows[0] as Record<string, unknown>);
    });
  }

  async updateContract(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        StaffContractRecord,
        'contractType' | 'startDate' | 'endDate' | 'salaryBand' | 'status' | 'notes'
      >
    >,
  ): Promise<StaffContractRecord | null> {
    await ensureStaffHrSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (patch.contractType !== undefined) {
        sets.push(`contract_type = $${i++}`);
        values.push(patch.contractType);
      }
      if (patch.startDate !== undefined) {
        sets.push(`start_date = $${i++}::date`);
        values.push(patch.startDate);
      }
      if (patch.endDate !== undefined) {
        sets.push(`end_date = $${i++}::date`);
        values.push(patch.endDate);
      }
      if (patch.salaryBand !== undefined) {
        sets.push(`salary_band = $${i++}`);
        values.push(patch.salaryBand);
      }
      if (patch.status !== undefined) {
        sets.push(`status = $${i++}`);
        values.push(patch.status);
      }
      if (patch.notes !== undefined) {
        sets.push(`notes = $${i++}`);
        values.push(patch.notes);
      }
      if (sets.length === 0) {
        return this.findContract(tenantId, id);
      }
      sets.push(`updated_at = now()`);
      values.push(id, tenantId);
      const { rows } = await client.query(
        `UPDATE staff_contracts SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
        values,
      );
      if (!rows[0]) return null;
      return mapContract(rows[0] as Record<string, unknown>);
    });
  }

  async createQualification(record: StaffQualificationRecord): Promise<StaffQualificationRecord> {
    await ensureStaffHrSchema(this.pool);
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO staff_qualifications (
           id, tenant_id, staff_id, degree, institution, year, verified, document_ref, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.staffId,
          record.degree,
          record.institution,
          record.year,
          record.verified,
          record.documentRef,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapQualification(rows[0] as Record<string, unknown>);
    });
  }

  async listQualifications(
    tenantId: string,
    staffId?: string,
  ): Promise<StaffQualificationRecord[]> {
    await ensureStaffHrSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = staffId
        ? await client.query(
            `SELECT * FROM staff_qualifications WHERE tenant_id = $1 AND staff_id = $2 ORDER BY year DESC`,
            [tenantId, staffId],
          )
        : await client.query(
            `SELECT * FROM staff_qualifications WHERE tenant_id = $1 ORDER BY year DESC`,
            [tenantId],
          );
      return rows.map((row) => mapQualification(row as Record<string, unknown>));
    });
  }

  async findQualification(tenantId: string, id: string): Promise<StaffQualificationRecord | null> {
    await ensureStaffHrSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM staff_qualifications WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!rows[0]) return null;
      return mapQualification(rows[0] as Record<string, unknown>);
    });
  }

  async updateQualification(
    tenantId: string,
    id: string,
    patch: Partial<Pick<StaffQualificationRecord, 'verified' | 'documentRef'>>,
  ): Promise<StaffQualificationRecord | null> {
    await ensureStaffHrSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (patch.verified !== undefined) {
        sets.push(`verified = $${i++}`);
        values.push(patch.verified);
      }
      if (patch.documentRef !== undefined) {
        sets.push(`document_ref = $${i++}`);
        values.push(patch.documentRef);
      }
      if (sets.length === 0) {
        return this.findQualification(tenantId, id);
      }
      sets.push(`updated_at = now()`);
      values.push(id, tenantId);
      const { rows } = await client.query(
        `UPDATE staff_qualifications SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
        values,
      );
      if (!rows[0]) return null;
      return mapQualification(rows[0] as Record<string, unknown>);
    });
  }

  async upsertAttendance(record: StaffAttendanceRecord): Promise<StaffAttendanceRecord> {
    await ensureStaffHrSchema(this.pool);
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO staff_hr_attendance (
           id, tenant_id, staff_id, attendance_date, status, notes, marked_by, created_at, updated_at
         ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, staff_id, attendance_date)
         DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, marked_by = EXCLUDED.marked_by, updated_at = now()
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.staffId,
          record.date,
          record.status,
          record.notes,
          record.markedBy,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapAttendance(rows[0] as Record<string, unknown>);
    });
  }

  async listAttendance(
    tenantId: string,
    filter: { date?: string; staffId?: string; from?: string; to?: string },
  ): Promise<StaffAttendanceRecord[]> {
    await ensureStaffHrSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const clauses = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let i = 2;
      if (filter.date) {
        clauses.push(`attendance_date = $${i++}::date`);
        values.push(filter.date);
      }
      if (filter.staffId) {
        clauses.push(`staff_id = $${i++}`);
        values.push(filter.staffId);
      }
      if (filter.from) {
        clauses.push(`attendance_date >= $${i++}::date`);
        values.push(filter.from);
      }
      if (filter.to) {
        clauses.push(`attendance_date <= $${i++}::date`);
        values.push(filter.to);
      }
      const { rows } = await client.query(
        `SELECT * FROM staff_hr_attendance WHERE ${clauses.join(' AND ')} ORDER BY attendance_date, staff_id`,
        values,
      );
      return rows.map((row) => mapAttendance(row as Record<string, unknown>));
    });
  }

  async findAttendance(
    tenantId: string,
    staffId: string,
    date: string,
  ): Promise<StaffAttendanceRecord | null> {
    const rows = await this.listAttendance(tenantId, { staffId, date });
    return rows[0] ?? null;
  }
}
