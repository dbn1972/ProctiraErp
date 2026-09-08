/**
 * Postgres workflow engine repositories (G-715).
 *
 * Back `WorkflowRepository` and `CaseRepository` with the tables from
 * db/sql/025_workflow_engine_schema.sql. Every statement runs inside
 * `withPgTenant` so the FORCEd RLS policies apply to the app role.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { withPgTenant, type PgPool, type PgQueryable } from '@proctira/database';

import type { CaseEntity, CaseFilter, CaseRepository } from './case-repository.js';
import type { CaseAttachmentInput, CaseResolutionInput, CaseStatus, CaseType } from './case-schemas.js';
import type { EscalationRuleInput, WorkflowStateInput, WorkflowTransitionInput } from './schemas.js';
import type {
  ApprovalRecord,
  TransitionAuditEntity,
  WorkflowDefinitionEntity,
  WorkflowDefinitionFilter,
  WorkflowInstanceEntity,
  WorkflowInstanceFilter,
  WorkflowInstanceStatus,
  WorkflowRepository,
} from './workflow-repository.js';

export type WorkflowPgPool = Pick<PgPool, 'query'> & Partial<Pick<PgPool, 'connect' | 'end'>>;

let schemaReady: Promise<void> | null = null;

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const name = '025_workflow_engine_schema.sql';
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

export async function ensureWorkflowEngineSchema(pool: WorkflowPgPool): Promise<void> {
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

type Row = Record<string, unknown>;

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
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

function jsonOrNull(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function paginate<T>(
  data: T[],
  totalItems: number,
  pagination: PaginationOptions,
): PaginatedResult<T> {
  return {
    data,
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pagination.pageSize),
    },
  };
}

function reviveApprovals(value: unknown): ApprovalRecord[] {
  return parseJson<ApprovalRecord[]>(value, []).map((record) => ({
    ...record,
    timestamp: toDate(record.timestamp),
  }));
}

function mapDefinition(row: Row): WorkflowDefinitionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    entityType: String(row.entity_type),
    description: nullableString(row.description),
    states: parseJson<WorkflowStateInput[]>(row.states, []),
    transitions: parseJson<WorkflowTransitionInput[]>(row.transitions, []),
    escalationRules:
      row.escalation_rules == null ? null : parseJson<EscalationRuleInput[]>(row.escalation_rules, []),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapInstance(row: Row): WorkflowInstanceEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    workflowDefinitionId: String(row.workflow_definition_id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    currentStateId: String(row.current_state_id),
    status: String(row.status) as WorkflowInstanceStatus,
    metadata: row.metadata == null ? null : parseJson<Record<string, unknown>>(row.metadata, {}),
    approvals: reviveApprovals(row.approvals),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAudit(row: Row): TransitionAuditEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    instanceId: String(row.instance_id),
    fromStateId: String(row.from_state_id),
    toStateId: String(row.to_state_id),
    action: String(row.action),
    actorId: String(row.actor_id),
    comments: nullableString(row.comments),
    timestamp: toDate(row.occurred_at),
  };
}

function mapCase(row: Row): CaseEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    type: String(row.type) as CaseType,
    title: String(row.title),
    description: String(row.description),
    status: String(row.status) as CaseStatus,
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    institutionId: nullableString(row.institution_id),
    areaId: nullableString(row.area_id),
    assignedTo: nullableString(row.assigned_to),
    priority: (nullableString(row.priority) as CaseEntity['priority']) ?? null,
    workflowInstanceId: nullableString(row.workflow_instance_id),
    attachments: parseJson<CaseAttachmentInput[]>(row.attachments, []),
    resolution: row.resolution == null ? null : parseJson<CaseResolutionInput>(row.resolution, {} as CaseResolutionInput),
    metadata: row.metadata == null ? null : parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

/** Builds `WHERE` fragments from optional equality filters. */
function equalityClauses(
  filters: Array<[column: string, value: string | undefined]>,
  startIndex: number,
): { sql: string; values: string[] } {
  const parts: string[] = [];
  const values: string[] = [];
  let i = startIndex;
  for (const [column, value] of filters) {
    if (value === undefined) continue;
    parts.push(`AND ${column} = $${i}`);
    values.push(value);
    i += 1;
  }
  return { sql: parts.join(' '), values };
}

abstract class PgWorkflowBase {
  constructor(protected readonly pool: WorkflowPgPool) {}

  protected async run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    await ensureWorkflowEngineSchema(this.pool);
    return withPgTenant(this.pool, tenantId, fn);
  }
}

export class PgWorkflowRepository extends PgWorkflowBase implements WorkflowRepository {
  // ─── Definitions ───────────────────────────────────────────────────────────

  async createDefinition(
    entity: Omit<WorkflowDefinitionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowDefinitionEntity> {
    return this.run(entity.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO workflow_definitions
           (id, tenant_id, name, entity_type, description, states, transitions, escalation_rules)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
         RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.name,
          entity.entityType,
          entity.description,
          JSON.stringify(entity.states),
          JSON.stringify(entity.transitions),
          jsonOrNull(entity.escalationRules),
        ],
      );
      return mapDefinition(res.rows[0] as Row);
    });
  }

  async findDefinitionById(id: string, tenantId: string): Promise<WorkflowDefinitionEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM workflow_definitions WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapDefinition(row) : null;
    });
  }

  async updateDefinition(
    id: string,
    tenantId: string,
    data: Partial<WorkflowDefinitionEntity>,
  ): Promise<WorkflowDefinitionEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `UPDATE workflow_definitions
            SET name = COALESCE($3, name),
                entity_type = COALESCE($4, entity_type),
                description = CASE WHEN $5::boolean THEN $6 ELSE description END,
                states = COALESCE($7::jsonb, states),
                transitions = COALESCE($8::jsonb, transitions),
                escalation_rules = CASE WHEN $9::boolean THEN $10::jsonb ELSE escalation_rules END
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [
          id,
          tenantId,
          data.name ?? null,
          data.entityType ?? null,
          data.description !== undefined,
          data.description ?? null,
          data.states ? JSON.stringify(data.states) : null,
          data.transitions ? JSON.stringify(data.transitions) : null,
          data.escalationRules !== undefined,
          jsonOrNull(data.escalationRules),
        ],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapDefinition(row) : null;
    });
  }

  async deleteDefinition(id: string, tenantId: string): Promise<boolean> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `DELETE FROM workflow_definitions WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      return Number(res.rowCount ?? 0) > 0;
    });
  }

  async listDefinitions(
    tenantId: string,
    filter: WorkflowDefinitionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowDefinitionEntity>> {
    return this.run(tenantId, async (c) => {
      const where = equalityClauses([['entity_type', filter.entityType]], 2);
      const total = await c.query(
        `SELECT COUNT(*)::int AS n FROM workflow_definitions WHERE tenant_id = $1 ${where.sql}`,
        [tenantId, ...where.values],
      );
      const offsetIdx = 2 + where.values.length;
      const rows = await c.query(
        `SELECT * FROM workflow_definitions WHERE tenant_id = $1 ${where.sql}
          ORDER BY created_at ASC, id LIMIT $${offsetIdx} OFFSET $${offsetIdx + 1}`,
        [tenantId, ...where.values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      );
      return paginate(
        (rows.rows as Row[]).map(mapDefinition),
        Number((total.rows[0] as Row).n),
        pagination,
      );
    });
  }

  // ─── Instances ─────────────────────────────────────────────────────────────

  async createInstance(
    entity: Omit<WorkflowInstanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowInstanceEntity> {
    return this.run(entity.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO workflow_instances
           (id, tenant_id, workflow_definition_id, entity_type, entity_id,
            current_state_id, status, metadata, approvals)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
         RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.workflowDefinitionId,
          entity.entityType,
          entity.entityId,
          entity.currentStateId,
          entity.status,
          jsonOrNull(entity.metadata),
          JSON.stringify(entity.approvals ?? []),
        ],
      );
      return mapInstance(res.rows[0] as Row);
    });
  }

  async findInstanceById(id: string, tenantId: string): Promise<WorkflowInstanceEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM workflow_instances WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapInstance(row) : null;
    });
  }

  async updateInstance(
    id: string,
    tenantId: string,
    data: Partial<WorkflowInstanceEntity>,
  ): Promise<WorkflowInstanceEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `UPDATE workflow_instances
            SET workflow_definition_id = COALESCE($3, workflow_definition_id),
                entity_type = COALESCE($4, entity_type),
                entity_id = COALESCE($5, entity_id),
                current_state_id = COALESCE($6, current_state_id),
                status = COALESCE($7, status),
                metadata = CASE WHEN $8::boolean THEN $9::jsonb ELSE metadata END,
                approvals = COALESCE($10::jsonb, approvals)
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [
          id,
          tenantId,
          data.workflowDefinitionId ?? null,
          data.entityType ?? null,
          data.entityId ?? null,
          data.currentStateId ?? null,
          data.status ?? null,
          data.metadata !== undefined,
          jsonOrNull(data.metadata),
          data.approvals ? JSON.stringify(data.approvals) : null,
        ],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapInstance(row) : null;
    });
  }

  async listInstances(
    tenantId: string,
    filter: WorkflowInstanceFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowInstanceEntity>> {
    return this.run(tenantId, async (c) => {
      const where = equalityClauses(
        [
          ['entity_type', filter.entityType],
          ['entity_id', filter.entityId],
          ['status', filter.status],
          ['workflow_definition_id', filter.workflowDefinitionId],
        ],
        2,
      );
      const total = await c.query(
        `SELECT COUNT(*)::int AS n FROM workflow_instances WHERE tenant_id = $1 ${where.sql}`,
        [tenantId, ...where.values],
      );
      const offsetIdx = 2 + where.values.length;
      const rows = await c.query(
        `SELECT * FROM workflow_instances WHERE tenant_id = $1 ${where.sql}
          ORDER BY created_at ASC, id LIMIT $${offsetIdx} OFFSET $${offsetIdx + 1}`,
        [tenantId, ...where.values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      );
      return paginate(
        (rows.rows as Row[]).map(mapInstance),
        Number((total.rows[0] as Row).n),
        pagination,
      );
    });
  }

  // ─── Transition audit ──────────────────────────────────────────────────────

  async createAuditRecord(entity: TransitionAuditEntity): Promise<TransitionAuditEntity> {
    return this.run(entity.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO workflow_transition_audit
           (id, tenant_id, instance_id, from_state_id, to_state_id, action, actor_id, comments, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.instanceId,
          entity.fromStateId,
          entity.toStateId,
          entity.action,
          entity.actorId,
          entity.comments,
          entity.timestamp,
        ],
      );
      return mapAudit(res.rows[0] as Row);
    });
  }

  async getAuditHistory(instanceId: string, tenantId: string): Promise<TransitionAuditEntity[]> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM workflow_transition_audit
          WHERE instance_id = $1 AND tenant_id = $2
          ORDER BY occurred_at ASC, id`,
        [instanceId, tenantId],
      );
      return (res.rows as Row[]).map(mapAudit);
    });
  }
}

export class PgCaseRepository extends PgWorkflowBase implements CaseRepository {
  async createCase(entity: Omit<CaseEntity, 'createdAt' | 'updatedAt'>): Promise<CaseEntity> {
    return this.run(entity.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO workflow_cases
           (id, tenant_id, type, title, description, status, entity_type, entity_id,
            institution_id, area_id, assigned_to, priority, workflow_instance_id,
            attachments, resolution, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb)
         RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.type,
          entity.title,
          entity.description,
          entity.status,
          entity.entityType,
          entity.entityId,
          entity.institutionId,
          entity.areaId,
          entity.assignedTo,
          entity.priority,
          entity.workflowInstanceId,
          JSON.stringify(entity.attachments ?? []),
          jsonOrNull(entity.resolution),
          jsonOrNull(entity.metadata),
        ],
      );
      return mapCase(res.rows[0] as Row);
    });
  }

  async findCaseById(id: string, tenantId: string): Promise<CaseEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(`SELECT * FROM workflow_cases WHERE id = $1 AND tenant_id = $2`, [
        id,
        tenantId,
      ]);
      const row = res.rows[0] as Row | undefined;
      return row ? mapCase(row) : null;
    });
  }

  async updateCase(id: string, tenantId: string, data: Partial<CaseEntity>): Promise<CaseEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `UPDATE workflow_cases
            SET type = COALESCE($3, type),
                title = COALESCE($4, title),
                description = COALESCE($5, description),
                status = COALESCE($6, status),
                entity_type = COALESCE($7, entity_type),
                entity_id = COALESCE($8, entity_id),
                institution_id = CASE WHEN $9::boolean THEN $10 ELSE institution_id END,
                area_id = CASE WHEN $11::boolean THEN $12 ELSE area_id END,
                assigned_to = CASE WHEN $13::boolean THEN $14 ELSE assigned_to END,
                priority = CASE WHEN $15::boolean THEN $16 ELSE priority END,
                workflow_instance_id = CASE WHEN $17::boolean THEN $18::uuid ELSE workflow_instance_id END,
                attachments = COALESCE($19::jsonb, attachments),
                resolution = CASE WHEN $20::boolean THEN $21::jsonb ELSE resolution END,
                metadata = CASE WHEN $22::boolean THEN $23::jsonb ELSE metadata END
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [
          id,
          tenantId,
          data.type ?? null,
          data.title ?? null,
          data.description ?? null,
          data.status ?? null,
          data.entityType ?? null,
          data.entityId ?? null,
          data.institutionId !== undefined,
          data.institutionId ?? null,
          data.areaId !== undefined,
          data.areaId ?? null,
          data.assignedTo !== undefined,
          data.assignedTo ?? null,
          data.priority !== undefined,
          data.priority ?? null,
          data.workflowInstanceId !== undefined,
          data.workflowInstanceId ?? null,
          data.attachments ? JSON.stringify(data.attachments) : null,
          data.resolution !== undefined,
          jsonOrNull(data.resolution),
          data.metadata !== undefined,
          jsonOrNull(data.metadata),
        ],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapCase(row) : null;
    });
  }

  async listCases(
    tenantId: string,
    filter: CaseFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CaseEntity>> {
    return this.run(tenantId, async (c) => {
      const where = equalityClauses(
        [
          ['type', filter.type],
          ['status', filter.status],
          ['entity_type', filter.entityType],
          ['entity_id', filter.entityId],
          ['assigned_to', filter.assignedTo],
          ['institution_id', filter.institutionId],
          ['area_id', filter.areaId],
        ],
        2,
      );
      const total = await c.query(
        `SELECT COUNT(*)::int AS n FROM workflow_cases WHERE tenant_id = $1 ${where.sql}`,
        [tenantId, ...where.values],
      );
      const offsetIdx = 2 + where.values.length;
      const rows = await c.query(
        `SELECT * FROM workflow_cases WHERE tenant_id = $1 ${where.sql}
          ORDER BY created_at ASC, id LIMIT $${offsetIdx} OFFSET $${offsetIdx + 1}`,
        [tenantId, ...where.values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      );
      return paginate((rows.rows as Row[]).map(mapCase), Number((total.rows[0] as Row).n), pagination);
    });
  }
}
