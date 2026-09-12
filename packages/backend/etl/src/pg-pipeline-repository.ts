/**
 * PostgreSQL pipeline repository (Wave 10 Option C).
 * Stores Pipeline / PipelineExecution as JSONB documents with RLS.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
  withPgTenant,
  type PgQueryable,
} from '@proctira/database';

import { InMemoryPipelineRepository } from './in-memory-repository.js';
import type {
  PipelineListFilter,
  PipelineListResult,
  PipelineRepository,
} from './pipeline-repository.js';
import type { Pipeline, PipelineExecution } from './schemas.js';

type Pool = NonNullable<ReturnType<typeof getSharedPgPool>>;

function revivePipeline(doc: Record<string, unknown>): Pipeline {
  return {
    ...(doc as unknown as Pipeline),
    createdAt: new Date(String(doc.createdAt)),
    updatedAt: new Date(String(doc.updatedAt)),
  };
}

function reviveExecution(doc: Record<string, unknown>): PipelineExecution {
  return {
    ...(doc as unknown as PipelineExecution),
    startedAt: new Date(String(doc.startedAt)),
    completedAt: doc.completedAt ? new Date(String(doc.completedAt)) : null,
  };
}

export class PgPipelineRepository implements PipelineRepository {
  constructor(private readonly pool: Pool) {}

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async create(pipeline: Pipeline): Promise<Pipeline> {
    const doc = {
      ...pipeline,
      createdAt: pipeline.createdAt.toISOString(),
      updatedAt: pipeline.updatedAt.toISOString(),
    };
    await this.withTenant(pipeline.tenantId, async (client) => {
      await client.query(
        `INSERT INTO etl_pipelines (id, tenant_id, name, enabled, document, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [
          pipeline.id,
          pipeline.tenantId,
          pipeline.name,
          pipeline.enabled,
          JSON.stringify(doc),
          pipeline.createdAt.toISOString(),
          pipeline.updatedAt.toISOString(),
        ],
      );
    });
    return { ...pipeline };
  }

  async update(id: string, tenantId: string, updates: Partial<Pipeline>): Promise<Pipeline> {
    const existing = await this.findById(id, tenantId);
    if (!existing) throw new Error(`Pipeline not found: ${id}`);
    const updated: Pipeline = { ...existing, ...updates, id, tenantId, updatedAt: new Date() };
    const doc = {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
    await this.withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE etl_pipelines SET name=$3, enabled=$4, document=$5::jsonb, updated_at=$6
         WHERE id=$1 AND tenant_id=$2`,
        [
          id,
          tenantId,
          updated.name,
          updated.enabled,
          JSON.stringify(doc),
          updated.updatedAt.toISOString(),
        ],
      );
    });
    return updated;
  }

  async delete(id: string, tenantId: string): Promise<void> {
    await this.withTenant(tenantId, async (client) => {
      await client.query(`DELETE FROM etl_pipelines WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    });
  }

  async findById(id: string, tenantId: string): Promise<Pipeline | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT document FROM etl_pipelines WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
        [id, tenantId],
      );
      const row = result.rows[0] as { document?: Record<string, unknown> } | undefined;
      return row?.document ? revivePipeline(row.document) : null;
    });
  }

  async list(
    tenantId: string,
    filter: PipelineListFilter,
    page: number,
    pageSize: number,
  ): Promise<PipelineListResult> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT document FROM etl_pipelines WHERE tenant_id=$1 ORDER BY updated_at DESC`,
        [tenantId],
      );
      let data = result.rows.map((r) =>
        revivePipeline((r as { document: Record<string, unknown> }).document),
      );
      if (filter.search) {
        const s = filter.search.toLowerCase();
        data = data.filter(
          (p) =>
            p.name.toLowerCase().includes(s) || (p.description?.toLowerCase().includes(s) ?? false),
        );
      }
      if (filter.enabled !== undefined) {
        data = data.filter((p) => p.enabled === filter.enabled);
      }
      const total = data.length;
      const offset = (page - 1) * pageSize;
      return { data: data.slice(offset, offset + pageSize), total };
    });
  }

  async createExecution(execution: PipelineExecution): Promise<PipelineExecution> {
    const doc = {
      ...execution,
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt?.toISOString() ?? null,
    };
    await this.withTenant(execution.tenantId, async (client) => {
      await client.query(
        `INSERT INTO etl_pipeline_runs
           (id, tenant_id, pipeline_id, status, document, started_at, completed_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [
          execution.id,
          execution.tenantId,
          execution.pipelineId,
          execution.status,
          JSON.stringify(doc),
          execution.startedAt.toISOString(),
          execution.completedAt?.toISOString() ?? null,
        ],
      );
    });
    return { ...execution };
  }

  async updateExecution(
    id: string,
    updates: Partial<PipelineExecution>,
  ): Promise<PipelineExecution> {
    // Load without tenant filter for update path used by executor
    const pool = this.pool;
    const found = await pool.query(
      `SELECT tenant_id, document FROM etl_pipeline_runs WHERE id=$1`,
      [id],
    );
    const row = found.rows[0] as
      | { tenant_id: string; document: Record<string, unknown> }
      | undefined;
    if (!row) throw new Error(`Execution not found: ${id}`);
    const existing = reviveExecution(row.document);
    const updated: PipelineExecution = { ...existing, ...updates, id };
    const doc = {
      ...updated,
      startedAt: updated.startedAt.toISOString(),
      completedAt: updated.completedAt?.toISOString() ?? null,
    };
    await this.withTenant(row.tenant_id, async (client) => {
      await client.query(
        `UPDATE etl_pipeline_runs SET status=$3, document=$4::jsonb, completed_at=$5
         WHERE id=$1 AND tenant_id=$2`,
        [
          id,
          row.tenant_id,
          updated.status,
          JSON.stringify(doc),
          updated.completedAt?.toISOString() ?? null,
        ],
      );
    });
    return updated;
  }

  async getExecution(id: string, tenantId: string): Promise<PipelineExecution | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT document FROM etl_pipeline_runs WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
        [id, tenantId],
      );
      const row = result.rows[0] as { document?: Record<string, unknown> } | undefined;
      return row?.document ? reviveExecution(row.document) : null;
    });
  }

  async listExecutions(
    pipelineId: string,
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: PipelineExecution[]; total: number }> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT document FROM etl_pipeline_runs
         WHERE tenant_id=$1 AND pipeline_id=$2 ORDER BY started_at DESC`,
        [tenantId, pipelineId],
      );
      const data = result.rows.map((r) =>
        reviveExecution((r as { document: Record<string, unknown> }).document),
      );
      const total = data.length;
      const offset = (page - 1) * pageSize;
      return { data: data.slice(offset, offset + pageSize), total };
    });
  }
}

/** Factory: PG when DATABASE_URL; else memory (P0-05: never silent memory when URL set). */
export function createPipelineRepository(): PipelineRepository {
  if (process.env.DATABASE_URL?.trim()) {
    const pool = getSharedPgPool();
    assertPostgresRepositoryAvailable('etl', pool);
    return new PgPipelineRepository(pool);
  }
  assertInMemoryFallbackAllowed('etl');
  return new InMemoryPipelineRepository();
}
