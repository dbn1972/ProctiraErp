/**
 * Postgres-backed infrastructure stores (G-901, raw `pg`, no Prisma).
 *
 * Rows persist via db/sql/027_institution_infrastructure_schema.sql. The
 * `InfrastructureStore` contract has no tenant argument, so the tenant is read
 * from the request-scoped {@link tenantContext} that `institutionPlugin` enters
 * on every request, and every query runs inside `withPgTenant` so RLS
 * (`app.tenant_id`) is bound.
 *
 * Every statement also carries an explicit `tenant_id = $n` predicate: RLS is
 * bypassed for superuser / table-owner roles (the default `POSTGRES_USER` in
 * container images is one), so the policy alone is not a tenancy guarantee.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';

import { requireTenantId } from '../tenant-context.js';
import type { InfrastructureTypeValue } from './schemas.js';
import type {
  ConditionOptionRecord,
  ConditionOptionStore,
  InfrastructureRecord,
  InfrastructureStore,
} from './service.js';

/** Pool surface we need (real pg.Pool, or a test double with `query`). */
export type InfrastructurePool = PgQueryable & { connect?: unknown; end?: () => Promise<void> };

let schemaReady: Promise<void> | null = null;

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = '027_institution_infrastructure_schema.sql';
  const candidates = [
    join(here, '../../../../../db/sql', file),
    join(process.cwd(), 'db/sql', file),
    join(process.cwd(), '../../db/sql', file),
    join(process.cwd(), '../../../db/sql', file),
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

/** Idempotently applies 027 (CREATE IF NOT EXISTS) — used by tests and standalone boot. */
export async function ensureInfrastructureSchema(pool: InfrastructurePool): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(readFileSync(schemaSqlPath(), 'utf8'));
    })().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

interface InfraRow {
  id: string;
  institution_id: string;
  parent_id: string | null;
  type: InfrastructureTypeValue;
  name: string;
  capacity: number;
  condition: string;
  description: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toRecord(row: InfraRow): InfrastructureRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    parentId: row.parent_id,
    type: row.type,
    name: row.name,
    capacity: Number(row.capacity),
    condition: row.condition,
    description: row.description,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const SORT_COLUMNS: Record<string, string> = {
  name: 'lower(name)',
  capacity: 'capacity',
  createdAt: 'created_at',
};

function orderClause(sortBy: string, sortOrder: 'asc' | 'desc'): string {
  const column = SORT_COLUMNS[sortBy] ?? SORT_COLUMNS['name']!;
  return `ORDER BY ${column} ${sortOrder === 'desc' ? 'DESC' : 'ASC'}, id ASC`;
}

export class PgInfrastructureStore implements InfrastructureStore {
  constructor(private readonly pool: InfrastructurePool) {}

  private run<T>(fn: (client: PgQueryable, tenantId: string) => Promise<T>): Promise<T> {
    const tenantId = requireTenantId();
    return withPgTenant(this.pool as never, tenantId, (client) => fn(client, tenantId));
  }

  async create(record: InfrastructureRecord): Promise<InfrastructureRecord> {
    return this.run(async (client, tenantId) => {
      const { rows } = await client.query(
        `INSERT INTO institution_infrastructure
           (id, tenant_id, institution_id, parent_id, type, name, capacity, condition, description, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          record.id,
          tenantId,
          record.institutionId,
          record.parentId,
          record.type,
          record.name,
          record.capacity,
          record.condition,
          record.description,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return toRecord(rows[0] as InfraRow);
    });
  }

  async findById(id: string): Promise<InfrastructureRecord | null> {
    return this.run(async (client, tenantId) => {
      const { rows } = await client.query(
        `SELECT * FROM institution_infrastructure WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      return rows[0] ? toRecord(rows[0] as InfraRow) : null;
    });
  }

  async findByInstitutionAndType(
    institutionId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }> {
    return this.page(`institution_id = $1 AND type = $2`, [institutionId, type], options);
  }

  async findByParent(
    parentId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }> {
    return this.page(`parent_id = $1 AND type = $2`, [parentId, type], options);
  }

  private page(
    where: string,
    params: unknown[],
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }> {
    return this.run(async (client, tenantId) => {
      const offset = Math.max(0, (options.page - 1) * options.pageSize);
      const scoped = `${where} AND tenant_id = $${params.length + 1}`;
      const scopedParams = [...params, tenantId];
      const [{ rows }, { rows: countRows }] = await Promise.all([
        client.query(
          `SELECT * FROM institution_infrastructure WHERE ${scoped}
           ${orderClause(options.sortBy, options.sortOrder)}
           LIMIT $${scopedParams.length + 1} OFFSET $${scopedParams.length + 2}`,
          [...scopedParams, options.pageSize, offset],
        ),
        client.query(
          `SELECT count(*)::int AS total FROM institution_infrastructure WHERE ${scoped}`,
          scopedParams,
        ),
      ]);
      return {
        items: (rows as InfraRow[]).map(toRecord),
        total: Number((countRows[0] as { total: number } | undefined)?.total ?? 0),
      };
    });
  }

  async findAllByInstitution(institutionId: string): Promise<InfrastructureRecord[]> {
    return this.run(async (client, tenantId) => {
      const { rows } = await client.query(
        `SELECT * FROM institution_infrastructure
          WHERE institution_id = $1 AND tenant_id = $2
          ORDER BY created_at ASC, id ASC`,
        [institutionId, tenantId],
      );
      return (rows as InfraRow[]).map(toRecord);
    });
  }

  async update(
    id: string,
    data: Partial<
      Pick<InfrastructureRecord, 'name' | 'capacity' | 'condition' | 'description' | 'updatedAt'>
    >,
  ): Promise<InfrastructureRecord | null> {
    return this.run(async (client, tenantId) => {
      const { rows } = await client.query(
        `UPDATE institution_infrastructure
            SET name = COALESCE($2, name),
                capacity = COALESCE($3, capacity),
                condition = COALESCE($4, condition),
                description = CASE WHEN $6::boolean THEN $5 ELSE description END,
                updated_at = COALESCE($7, now())
          WHERE id = $1 AND tenant_id = $8
          RETURNING *`,
        [
          id,
          data.name ?? null,
          data.capacity ?? null,
          data.condition ?? null,
          data.description ?? null,
          data.description !== undefined,
          data.updatedAt ?? null,
          tenantId,
        ],
      );
      return rows[0] ? toRecord(rows[0] as InfraRow) : null;
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.run(async (client, tenantId) => {
      const result = await client.query(
        `DELETE FROM institution_infrastructure WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }

  async hasChildren(id: string): Promise<boolean> {
    return this.run(async (client, tenantId) => {
      const { rows } = await client.query(
        `SELECT 1 FROM institution_infrastructure WHERE parent_id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      return rows.length > 0;
    });
  }
}

interface ConditionRow {
  id: string;
  name: string;
  description: string | null;
}

export class PgConditionOptionStore implements ConditionOptionStore {
  constructor(private readonly pool: InfrastructurePool) {}

  private run<T>(fn: (client: PgQueryable, tenantId: string) => Promise<T>): Promise<T> {
    const tenantId = requireTenantId();
    return withPgTenant(this.pool as never, tenantId, (client) => fn(client, tenantId));
  }

  async create(record: ConditionOptionRecord): Promise<ConditionOptionRecord> {
    return this.run(async (client, tenantId) => {
      const { rows } = await client.query(
        `INSERT INTO institution_condition_options (id, tenant_id, name, description)
         VALUES ($1,$2,$3,$4) RETURNING id, name, description`,
        [record.id, tenantId, record.name, record.description],
      );
      return rows[0] as ConditionRow;
    });
  }

  async findAll(): Promise<ConditionOptionRecord[]> {
    return this.run(async (client, tenantId) => {
      const { rows } = await client.query(
        `SELECT id, name, description FROM institution_condition_options
          WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      return rows as ConditionRow[];
    });
  }

  async findByName(name: string): Promise<ConditionOptionRecord | null> {
    return this.run(async (client, tenantId) => {
      const { rows } = await client.query(
        `SELECT id, name, description FROM institution_condition_options
          WHERE name = $1 AND tenant_id = $2 LIMIT 1`,
        [name, tenantId],
      );
      return (rows[0] as ConditionRow | undefined) ?? null;
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.run(async (client, tenantId) => {
      const result = await client.query(
        `DELETE FROM institution_condition_options WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }
}
