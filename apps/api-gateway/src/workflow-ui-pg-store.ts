/**
 * Postgres-backed store for workflow UI aggregates (G-208).
 * Keeps the UI API shape while persisting definitions/instances/approvals.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';

import {
  createWorkflowUiSeed,
  type UiWorkflowApproval,
  type UiWorkflowDefinition,
  type UiWorkflowInstance,
  type UiWorkflowStep,
  type WorkflowUiSeed,
} from './workflow-ui-seed.js';

const { Pool } = pg;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function isPgWorkflowUiEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function getPool(): pg.Pool | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!sharedPool) sharedPool = new Pool({ connectionString: url });
  return sharedPool;
}

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../db/sql/019_workflow_ui_schema.sql'),
    join(process.cwd(), 'db/sql/019_workflow_ui_schema.sql'),
    join(process.cwd(), '../../db/sql/019_workflow_ui_schema.sql'),
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

async function ensureSchema(pool: pg.Pool): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(readFileSync(schemaSqlPath(), 'utf8'));
    })();
  }
  await schemaReady;
}

function parseSteps(value: unknown): UiWorkflowStep[] {
  if (value == null) return [];
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as UiWorkflowStep[];
    } catch {
      return [];
    }
  }
  return value as UiWorkflowStep[];
}

function mapDefinition(row: Record<string, unknown>): UiWorkflowDefinition {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    module: String(row.module),
    version: Number(row.version),
    steps: parseSteps(row.steps),
    active: Boolean(row.active),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(String(row.updated_at)).toISOString(),
  };
}

function mapInstance(row: Record<string, unknown>): UiWorkflowInstance {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    definitionId: String(row.definition_id),
    definitionName: String(row.definition_name),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    initiatedBy: String(row.initiated_by),
    initiatedAt:
      row.initiated_at instanceof Date
        ? row.initiated_at.toISOString()
        : new Date(String(row.initiated_at)).toISOString(),
    currentStep: String(row.current_step),
    status: String(row.status) as UiWorkflowInstance['status'],
  };
}

function mapApproval(row: Record<string, unknown>): UiWorkflowApproval {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    instanceId: String(row.instance_id),
    definitionName: String(row.definition_name),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    stepName: String(row.step_name),
    requestedAt:
      row.requested_at instanceof Date
        ? row.requested_at.toISOString()
        : new Date(String(row.requested_at)).toISOString(),
    requestedBy: String(row.requested_by),
  };
}

export interface WorkflowUiStore {
  readonly persistence: 'postgres' | 'memory';
  listDefinitions(tenantId: string): Promise<UiWorkflowDefinition[]>;
  getDefinition(tenantId: string, id: string): Promise<UiWorkflowDefinition | null>;
  createDefinition(definition: UiWorkflowDefinition): Promise<UiWorkflowDefinition>;
  listInstances(tenantId: string): Promise<UiWorkflowInstance[]>;
  listPendingApprovals(tenantId: string): Promise<UiWorkflowApproval[]>;
  decideApproval(
    tenantId: string,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<{ id: string; instanceId: string; status: 'APPROVED' | 'REJECTED' } | null>;
}

class InMemoryWorkflowUiStore implements WorkflowUiStore {
  readonly persistence = 'memory' as const;

  constructor(private readonly seed: WorkflowUiSeed) {}

  async listDefinitions(tenantId: string): Promise<UiWorkflowDefinition[]> {
    return this.seed.definitions.filter((d) => d.tenantId === tenantId);
  }

  async getDefinition(tenantId: string, id: string): Promise<UiWorkflowDefinition | null> {
    return this.seed.definitions.find((d) => d.tenantId === tenantId && d.id === id) ?? null;
  }

  async createDefinition(definition: UiWorkflowDefinition): Promise<UiWorkflowDefinition> {
    this.seed.definitions.unshift(definition);
    return definition;
  }

  async listInstances(tenantId: string): Promise<UiWorkflowInstance[]> {
    return this.seed.instances.filter((i) => i.tenantId === tenantId);
  }

  async listPendingApprovals(tenantId: string): Promise<UiWorkflowApproval[]> {
    return this.seed.approvals.filter((a) => a.tenantId === tenantId);
  }

  async decideApproval(
    tenantId: string,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<{ id: string; instanceId: string; status: 'APPROVED' | 'REJECTED' } | null> {
    const approvalIndex = this.seed.approvals.findIndex(
      (a) => a.id === approvalId && a.tenantId === tenantId,
    );
    if (approvalIndex === -1) return null;
    const [approval] = this.seed.approvals.splice(approvalIndex, 1);
    if (!approval) return null;
    const instance = this.seed.instances.find(
      (i) => i.id === approval.instanceId && i.tenantId === tenantId,
    );
    if (instance) {
      instance.status = decision;
      instance.currentStep = decision === 'APPROVED' ? 'Completed' : 'Rejected';
    }
    return { id: approval.id, instanceId: approval.instanceId, status: decision };
  }
}

export class PgWorkflowUiStore implements WorkflowUiStore {
  readonly persistence = 'postgres' as const;
  private seeded = false;

  constructor(private readonly pool: pg.Pool) {}

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  private async ensureReady(): Promise<void> {
    await ensureSchema(this.pool);
    if (this.seeded) return;
    this.seeded = true;
    // Seed demo rows once per process if the demo tenant has no definitions yet.
    const seed = createWorkflowUiSeed();
    const demoTenant = seed.definitions[0]?.tenantId;
    if (!demoTenant) return;
    await this.withTenant(demoTenant, async (client) => {
      const count = await client.query(
        `SELECT COUNT(*)::int AS c FROM workflow_ui_definitions WHERE tenant_id = $1`,
        [demoTenant],
      );
      if (Number((count.rows[0] as { c: number }).c) > 0) return;
      for (const def of seed.definitions) {
        await client.query(
          `INSERT INTO workflow_ui_definitions
             (id, tenant_id, name, module, version, steps, active, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
           ON CONFLICT (id) DO NOTHING`,
          [
            def.id,
            def.tenantId,
            def.name,
            def.module,
            def.version,
            JSON.stringify(def.steps),
            def.active,
            def.updatedAt,
          ],
        );
      }
      for (const inst of seed.instances) {
        await client.query(
          `INSERT INTO workflow_ui_instances
             (id, tenant_id, definition_id, definition_name, subject_type, subject_id,
              initiated_by, initiated_at, current_step, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO NOTHING`,
          [
            inst.id,
            inst.tenantId,
            inst.definitionId,
            inst.definitionName,
            inst.subjectType,
            inst.subjectId,
            inst.initiatedBy,
            inst.initiatedAt,
            inst.currentStep,
            inst.status,
          ],
        );
      }
      for (const appr of seed.approvals) {
        await client.query(
          `INSERT INTO workflow_ui_approvals
             (id, tenant_id, instance_id, definition_name, subject_type, subject_id,
              step_name, requested_at, requested_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO NOTHING`,
          [
            appr.id,
            appr.tenantId,
            appr.instanceId,
            appr.definitionName,
            appr.subjectType,
            appr.subjectId,
            appr.stepName,
            appr.requestedAt,
            appr.requestedBy,
          ],
        );
      }
    });
  }

  async listDefinitions(tenantId: string): Promise<UiWorkflowDefinition[]> {
    await this.ensureReady();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM workflow_ui_definitions WHERE tenant_id = $1 ORDER BY updated_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapDefinition(row as Record<string, unknown>));
    });
  }

  async getDefinition(tenantId: string, id: string): Promise<UiWorkflowDefinition | null> {
    await this.ensureReady();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM workflow_ui_definitions WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapDefinition(result.rows[0] as Record<string, unknown>);
    });
  }

  async createDefinition(definition: UiWorkflowDefinition): Promise<UiWorkflowDefinition> {
    await this.ensureReady();
    return this.withTenant(definition.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO workflow_ui_definitions
           (id, tenant_id, name, module, version, steps, active, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         RETURNING *`,
        [
          definition.id,
          definition.tenantId,
          definition.name,
          definition.module,
          definition.version,
          JSON.stringify(definition.steps),
          definition.active,
          definition.updatedAt,
        ],
      );
      return mapDefinition(result.rows[0] as Record<string, unknown>);
    });
  }

  async listInstances(tenantId: string): Promise<UiWorkflowInstance[]> {
    await this.ensureReady();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM workflow_ui_instances WHERE tenant_id = $1 ORDER BY initiated_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapInstance(row as Record<string, unknown>));
    });
  }

  async listPendingApprovals(tenantId: string): Promise<UiWorkflowApproval[]> {
    await this.ensureReady();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM workflow_ui_approvals WHERE tenant_id = $1 ORDER BY requested_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapApproval(row as Record<string, unknown>));
    });
  }

  async decideApproval(
    tenantId: string,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<{ id: string; instanceId: string; status: 'APPROVED' | 'REJECTED' } | null> {
    await this.ensureReady();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM workflow_ui_approvals WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [approvalId, tenantId],
      );
      if (!existing.rows[0]) return null;
      const approval = mapApproval(existing.rows[0] as Record<string, unknown>);
      await client.query(`DELETE FROM workflow_ui_approvals WHERE id = $1 AND tenant_id = $2`, [
        approvalId,
        tenantId,
      ]);
      await client.query(
        `UPDATE workflow_ui_instances
         SET status = $3, current_step = $4
         WHERE id = $1 AND tenant_id = $2`,
        [
          approval.instanceId,
          tenantId,
          decision,
          decision === 'APPROVED' ? 'Completed' : 'Rejected',
        ],
      );
      return { id: approval.id, instanceId: approval.instanceId, status: decision };
    });
  }
}

export function createWorkflowUiStore(
  seed?: WorkflowUiSeed,
  options?: { forceMemory?: boolean },
): WorkflowUiStore {
  if (!options?.forceMemory) {
    const pool = getPool();
    if (pool && isPgWorkflowUiEnabled()) {
      return new PgWorkflowUiStore(pool);
    }
  }
  return new InMemoryWorkflowUiStore(seed ?? createWorkflowUiSeed());
}
