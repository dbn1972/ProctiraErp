/**
 * Postgres report-card repositories (G-717).
 *
 * Persist templates, teacher comments, institution branding and generation
 * jobs to the `report_card_*` tables from
 * db/sql/024_wave7_domain_persistence_schema.sql. Every statement runs under
 * `withPgTenant` so the FORCEd RLS policies apply to the app role.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable, type PgPool } from '@proctira/database';

import type {
  InstitutionBrandingEntity,
  InstitutionBrandingRepository,
  ReportCardJobEntity,
  ReportCardJobRepository,
  ReportCardJobStatus,
  ReportCardTemplateEntity,
  ReportCardTemplateRepository,
  TeacherCommentEntity,
  TeacherCommentRepository,
} from './report-card-repository.js';

export type ReportCardPgPool = Pick<PgPool, 'query'> & Partial<Pick<PgPool, 'connect' | 'end'>>;

let schemaReady: Promise<void> | null = null;

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const name = '024_wave7_domain_persistence_schema.sql';
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

export async function ensureReportCardSchema(pool: ReportCardPgPool): Promise<void> {
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

function nullableDate(value: unknown): Date | null {
  return value == null ? null : toDate(value);
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function mapTemplate(row: Row): ReportCardTemplateEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    templateContent: String(row.template_content),
    isDefault: Boolean(row.is_default),
    includeLogo: Boolean(row.include_logo),
    includeGradeSummary: Boolean(row.include_grade_summary),
    includeComments: Boolean(row.include_comments),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapComment(row: Row): TeacherCommentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    subjectId: String(row.subject_id),
    academicPeriodId: String(row.academic_period_id),
    teacherId: String(row.teacher_id),
    comment: String(row.comment),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapBranding(row: Row): InstitutionBrandingEntity {
  return {
    institutionId: String(row.institution_id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    logoUrl: nullableString(row.logo_url),
    address: nullableString(row.address),
    contactPhone: nullableString(row.contact_phone),
    contactEmail: nullableString(row.contact_email),
  };
}

function mapJob(row: Row): ReportCardJobEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    academicPeriodId: String(row.academic_period_id),
    templateId: String(row.template_id),
    institutionId: String(row.institution_id),
    status: String(row.status) as ReportCardJobStatus,
    errorMessage: nullableString(row.error_message),
    outputUrl: nullableString(row.output_url),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    completedAt: nullableDate(row.completed_at),
  };
}

abstract class PgReportCardBase {
  constructor(protected readonly pool: ReportCardPgPool) {}

  protected async run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    await ensureReportCardSchema(this.pool);
    return withPgTenant(this.pool, tenantId, fn);
  }
}

export class PgReportCardTemplateRepository
  extends PgReportCardBase
  implements ReportCardTemplateRepository
{
  async create(
    data: Omit<ReportCardTemplateEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ReportCardTemplateEntity> {
    return this.run(data.tenantId, async (c) => {
      if (data.isDefault) {
        await c.query(
          `UPDATE report_card_templates SET is_default = FALSE WHERE tenant_id = $1 AND is_default`,
          [data.tenantId],
        );
      }
      const res = await c.query(
        `INSERT INTO report_card_templates
           (id, tenant_id, name, template_content, is_default,
            include_logo, include_grade_summary, include_comments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.name,
          data.templateContent,
          data.isDefault,
          data.includeLogo,
          data.includeGradeSummary,
          data.includeComments,
        ],
      );
      return mapTemplate(res.rows[0] as Row);
    });
  }

  async findById(id: string, tenantId: string): Promise<ReportCardTemplateEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM report_card_templates WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapTemplate(row) : null;
    });
  }

  async findDefault(tenantId: string): Promise<ReportCardTemplateEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM report_card_templates WHERE tenant_id = $1 AND is_default LIMIT 1`,
        [tenantId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapTemplate(row) : null;
    });
  }

  async list(tenantId: string): Promise<ReportCardTemplateEntity[]> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM report_card_templates WHERE tenant_id = $1 ORDER BY created_at ASC, id`,
        [tenantId],
      );
      return (res.rows as Row[]).map(mapTemplate);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<ReportCardTemplateEntity>,
  ): Promise<ReportCardTemplateEntity | null> {
    return this.run(tenantId, async (c) => {
      if (data.isDefault === true) {
        await c.query(
          `UPDATE report_card_templates SET is_default = FALSE
            WHERE tenant_id = $1 AND is_default AND id <> $2`,
          [tenantId, id],
        );
      }
      const res = await c.query(
        `UPDATE report_card_templates
            SET name = COALESCE($3, name),
                template_content = COALESCE($4, template_content),
                is_default = COALESCE($5, is_default),
                include_logo = COALESCE($6, include_logo),
                include_grade_summary = COALESCE($7, include_grade_summary),
                include_comments = COALESCE($8, include_comments)
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [
          id,
          tenantId,
          data.name ?? null,
          data.templateContent ?? null,
          data.isDefault ?? null,
          data.includeLogo ?? null,
          data.includeGradeSummary ?? null,
          data.includeComments ?? null,
        ],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapTemplate(row) : null;
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `DELETE FROM report_card_templates WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      return Number(res.rowCount ?? 0) > 0;
    });
  }
}

export class PgTeacherCommentRepository extends PgReportCardBase implements TeacherCommentRepository {
  async upsert(
    data: Omit<TeacherCommentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TeacherCommentEntity> {
    return this.run(data.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO report_card_teacher_comments
           (id, tenant_id, student_id, subject_id, academic_period_id, teacher_id, comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, student_id, subject_id, academic_period_id)
         DO UPDATE SET teacher_id = EXCLUDED.teacher_id, comment = EXCLUDED.comment
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.subjectId,
          data.academicPeriodId,
          data.teacherId,
          data.comment,
        ],
      );
      return mapComment(res.rows[0] as Row);
    });
  }

  async findByStudentAndPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<TeacherCommentEntity[]> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM report_card_teacher_comments
          WHERE tenant_id = $1 AND student_id = $2 AND academic_period_id = $3
          ORDER BY created_at ASC, id`,
        [tenantId, studentId, academicPeriodId],
      );
      return (res.rows as Row[]).map(mapComment);
    });
  }

  async findByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<TeacherCommentEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM report_card_teacher_comments
          WHERE tenant_id = $1 AND student_id = $2 AND subject_id = $3 AND academic_period_id = $4`,
        [tenantId, studentId, subjectId, academicPeriodId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapComment(row) : null;
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `DELETE FROM report_card_teacher_comments WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      return Number(res.rowCount ?? 0) > 0;
    });
  }
}

export class PgInstitutionBrandingRepository
  extends PgReportCardBase
  implements InstitutionBrandingRepository
{
  async findByInstitutionId(
    institutionId: string,
    tenantId: string,
  ): Promise<InstitutionBrandingEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM report_card_institution_branding
          WHERE institution_id = $1 AND tenant_id = $2`,
        [institutionId, tenantId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapBranding(row) : null;
    });
  }

  /** Create or replace branding for an institution. */
  async upsert(branding: InstitutionBrandingEntity): Promise<InstitutionBrandingEntity> {
    return this.run(branding.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO report_card_institution_branding
           (institution_id, tenant_id, name, logo_url, address, contact_phone, contact_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, institution_id)
         DO UPDATE SET name = EXCLUDED.name, logo_url = EXCLUDED.logo_url,
                       address = EXCLUDED.address, contact_phone = EXCLUDED.contact_phone,
                       contact_email = EXCLUDED.contact_email
         RETURNING *`,
        [
          branding.institutionId,
          branding.tenantId,
          branding.name,
          branding.logoUrl,
          branding.address,
          branding.contactPhone,
          branding.contactEmail,
        ],
      );
      return mapBranding(res.rows[0] as Row);
    });
  }
}

export class PgReportCardJobRepository extends PgReportCardBase implements ReportCardJobRepository {
  async create(
    data: Omit<ReportCardJobEntity, 'createdAt' | 'updatedAt' | 'completedAt'>,
  ): Promise<ReportCardJobEntity> {
    return this.run(data.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO report_card_jobs
           (id, tenant_id, student_id, academic_period_id, template_id, institution_id,
            status, error_message, output_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.academicPeriodId,
          data.templateId,
          data.institutionId,
          data.status,
          data.errorMessage,
          data.outputUrl,
        ],
      );
      return mapJob(res.rows[0] as Row);
    });
  }

  async findById(id: string, tenantId: string): Promise<ReportCardJobEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM report_card_jobs WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapJob(row) : null;
    });
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: ReportCardJobStatus,
    details?: { errorMessage?: string; outputUrl?: string; completedAt?: Date },
  ): Promise<ReportCardJobEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `UPDATE report_card_jobs
            SET status = $3,
                error_message = COALESCE($4, error_message),
                output_url = COALESCE($5, output_url),
                completed_at = COALESCE($6, completed_at)
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [
          id,
          tenantId,
          status,
          details?.errorMessage ?? null,
          details?.outputUrl ?? null,
          details?.completedAt ?? null,
        ],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapJob(row) : null;
    });
  }

  async findByStudentAndPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<ReportCardJobEntity[]> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM report_card_jobs
          WHERE tenant_id = $1 AND student_id = $2 AND academic_period_id = $3
          ORDER BY created_at DESC, id`,
        [tenantId, studentId, academicPeriodId],
      );
      return (res.rows as Row[]).map(mapJob);
    });
  }
}
