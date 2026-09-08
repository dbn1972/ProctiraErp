/**
 * Postgres appraisal repositories (G-717) on `hr_appraisal_templates` and
 * `hr_appraisals` (db/sql/024). Every query binds `app.tenant_id` via
 * `withPgTenant` so RLS enforces isolation.
 */
import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { withPgTenant, type PgQueryable } from '@proctira/database';

import type {
  AppraisalCriterionEntity,
  AppraisalEntity,
  AppraisalFilter,
  AppraisalRepository,
  AppraisalScoreEntity,
  AppraisalTemplateEntity,
  AppraisalTemplateRepository,
} from './appraisal-repository.js';
import { ensureHrSchema, parseJson, toDate, toDateStr, type PgPoolLike } from './pg-hr-schema.js';

function mapTemplate(row: Record<string, unknown>): AppraisalTemplateEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    academicPeriodId: String(row.academic_period_id),
    criteria: parseJson<AppraisalCriterionEntity[]>(row.criteria, []),
    scoreMin: Number(row.score_min),
    scoreMax: Number(row.score_max),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAppraisal(row: Record<string, unknown>): AppraisalEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    staffId: String(row.staff_id),
    templateId: String(row.template_id),
    appraisalDate: toDateStr(row.appraisal_date),
    scores: parseJson<AppraisalScoreEntity[]>(row.scores, []),
    totalScore: Number(row.total_score),
    overallComment: row.overall_comment == null ? null : String(row.overall_comment),
    status: String(row.status) as AppraisalEntity['status'],
    workflowInstanceId: row.workflow_instance_id == null ? null : String(row.workflow_instance_id),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function paginate<T>(data: T[], totalItems: number, pagination: PaginationOptions): PaginatedResult<T> {
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

export class PgAppraisalTemplateRepository implements AppraisalTemplateRepository {
  constructor(private readonly pool: PgPoolLike) {}

  private async run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    await ensureHrSchema(this.pool);
    return withPgTenant(this.pool, tenantId, fn);
  }

  async create(
    data: Omit<AppraisalTemplateEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AppraisalTemplateEntity> {
    return this.run(data.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO hr_appraisal_templates
           (id, tenant_id, name, description, academic_period_id, criteria, score_min, score_max)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.name,
          data.description,
          data.academicPeriodId,
          JSON.stringify(data.criteria),
          data.scoreMin,
          data.scoreMax,
        ],
      );
      return mapTemplate(res.rows[0] as Record<string, unknown>);
    });
  }

  async findById(id: string, tenantId: string): Promise<AppraisalTemplateEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM hr_appraisal_templates WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapTemplate(row) : null;
    });
  }

  async list(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalTemplateEntity>> {
    return this.run(tenantId, async (c) => {
      const total = await c.query(
        `SELECT COUNT(*)::int AS n FROM hr_appraisal_templates WHERE tenant_id = $1`,
        [tenantId],
      );
      const rows = await c.query(
        `SELECT * FROM hr_appraisal_templates WHERE tenant_id = $1
         ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
        [tenantId, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      );
      return paginate(
        (rows.rows as Record<string, unknown>[]).map(mapTemplate),
        Number((total.rows[0] as { n: number }).n),
        pagination,
      );
    });
  }
}

export class PgAppraisalRepository implements AppraisalRepository {
  constructor(private readonly pool: PgPoolLike) {}

  private async run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    await ensureHrSchema(this.pool);
    return withPgTenant(this.pool, tenantId, fn);
  }

  async create(data: Omit<AppraisalEntity, 'createdAt' | 'updatedAt'>): Promise<AppraisalEntity> {
    return this.run(data.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO hr_appraisals
           (id, tenant_id, staff_id, template_id, appraisal_date, scores, total_score,
            overall_comment, status, workflow_instance_id)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.staffId,
          data.templateId,
          data.appraisalDate,
          JSON.stringify(data.scores),
          data.totalScore,
          data.overallComment,
          data.status,
          data.workflowInstanceId,
        ],
      );
      return mapAppraisal(res.rows[0] as Record<string, unknown>);
    });
  }

  async findById(id: string, tenantId: string): Promise<AppraisalEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(`SELECT * FROM hr_appraisals WHERE id = $1 AND tenant_id = $2`, [
        id,
        tenantId,
      ]);
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapAppraisal(row) : null;
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<AppraisalEntity>,
  ): Promise<AppraisalEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `UPDATE hr_appraisals SET
           appraisal_date       = COALESCE($3, appraisal_date),
           scores               = COALESCE($4::jsonb, scores),
           total_score          = COALESCE($5, total_score),
           overall_comment      = CASE WHEN $6::boolean THEN $7 ELSE overall_comment END,
           status               = COALESCE($8, status),
           workflow_instance_id = CASE WHEN $9::boolean THEN $10 ELSE workflow_instance_id END
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          data.appraisalDate ?? null,
          data.scores === undefined ? null : JSON.stringify(data.scores),
          data.totalScore ?? null,
          data.overallComment !== undefined,
          data.overallComment ?? null,
          data.status ?? null,
          data.workflowInstanceId !== undefined,
          data.workflowInstanceId ?? null,
        ],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapAppraisal(row) : null;
    });
  }

  async list(
    tenantId: string,
    filter: AppraisalFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalEntity>> {
    return this.run(tenantId, async (c) => {
      const where: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter.staffId) {
        params.push(filter.staffId);
        where.push(`staff_id = $${params.length}`);
      }
      if (filter.templateId) {
        params.push(filter.templateId);
        where.push(`template_id = $${params.length}`);
      }
      if (filter.status) {
        params.push(filter.status);
        where.push(`status = $${params.length}`);
      }
      const clause = where.join(' AND ');
      const total = await c.query(`SELECT COUNT(*)::int AS n FROM hr_appraisals WHERE ${clause}`, params);
      const rows = await c.query(
        `SELECT * FROM hr_appraisals WHERE ${clause}
         ORDER BY appraisal_date DESC, created_at DESC, id
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      );
      return paginate(
        (rows.rows as Record<string, unknown>[]).map(mapAppraisal),
        Number((total.rows[0] as { n: number }).n),
        pagination,
      );
    });
  }
}
