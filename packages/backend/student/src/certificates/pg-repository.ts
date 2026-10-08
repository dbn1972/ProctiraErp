/**
 * PRC-H095: Postgres-backed lifecycle certificate repository (raw `pg`, RLS via
 * withPgTenant). Durable replacement for InMemoryLifecycleCertificateRepository
 * so issued certificates, serials and revocations survive restarts and are
 * consistent across gateway replicas.
 *
 * Table: student_lifecycle_certificates (db/sql/130).
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';

import type { LifecycleCertificate, LifecycleCertificateRepository } from './types.js';

interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<unknown>;
}

function mapRow(row: Record<string, unknown>): LifecycleCertificate {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    studentId: row['student_id'] as string,
    type: row['type'] as LifecycleCertificate['type'],
    serialNumber: row['serial_number'] as string,
    status: row['status'] as LifecycleCertificate['status'],
    issuedBy: row['issued_by'] as string,
    issuedAt: new Date(row['issued_at'] as string),
    revokedAt: row['revoked_at'] ? new Date(row['revoked_at'] as string) : null,
    revokeReason: (row['revoke_reason'] as string | null) ?? null,
    academicYear: (row['academic_year'] as string | null) ?? null,
    remarks: (row['remarks'] as string | null) ?? null,
    checksum: row['checksum'] as string,
  };
}

export class PgLifecycleCertificateRepository implements LifecycleCertificateRepository {
  constructor(private readonly pool: PgPoolLike) {}

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async create(entity: LifecycleCertificate): Promise<LifecycleCertificate> {
    return this.withTenant(entity.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO student_lifecycle_certificates (
           id, tenant_id, student_id, type, serial_number, status,
           issued_by, issued_at, revoked_at, revoke_reason,
           academic_year, remarks, checksum, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now()
         ) RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.studentId,
          entity.type,
          entity.serialNumber,
          entity.status,
          entity.issuedBy,
          entity.issuedAt,
          entity.revokedAt,
          entity.revokeReason,
          entity.academicYear,
          entity.remarks,
          entity.checksum,
        ],
      );
      return mapRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async findById(tenantId: string, id: string): Promise<LifecycleCertificate | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM student_lifecycle_certificates WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapRow(row) : null;
    });
  }

  async findBySerial(tenantId: string, serialNumber: string): Promise<LifecycleCertificate | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM student_lifecycle_certificates
          WHERE serial_number = $1 AND tenant_id = $2`,
        [serialNumber, tenantId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapRow(row) : null;
    });
  }

  async listByStudent(tenantId: string, studentId: string): Promise<LifecycleCertificate[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM student_lifecycle_certificates
          WHERE tenant_id = $1 AND student_id = $2
          ORDER BY issued_at DESC`,
        [tenantId, studentId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapRow);
    });
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<LifecycleCertificate, 'status' | 'revokedAt' | 'revokeReason'>>,
  ): Promise<LifecycleCertificate | null> {
    return this.withTenant(tenantId, async (client) => {
      // Conditional update keeps the write tenant-scoped; only mutable fields.
      const result = await client.query(
        `UPDATE student_lifecycle_certificates
            SET status = COALESCE($3, status),
                revoked_at = CASE WHEN $4::boolean THEN $5 ELSE revoked_at END,
                revoke_reason = CASE WHEN $4::boolean THEN $6 ELSE revoke_reason END,
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [
          id,
          tenantId,
          patch.status ?? null,
          Object.prototype.hasOwnProperty.call(patch, 'revokedAt') ||
            Object.prototype.hasOwnProperty.call(patch, 'revokeReason'),
          patch.revokedAt ?? null,
          patch.revokeReason ?? null,
        ],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapRow(row) : null;
    });
  }
}
