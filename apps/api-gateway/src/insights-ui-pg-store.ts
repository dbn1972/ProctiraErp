/**
 * Postgres-backed store for Insights UI aggregates (G-209).
 * Keeps the redesign App Router API shape while persisting templates, runs,
 * and warehouse import jobs so mutations survive process restart.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';

import {
  seedGeoFeatures,
  seedIndicators,
  seedTemplates,
  type DwGeoFeature,
  type DwImportJob,
  type DwIndicator,
  type ReportRun,
  type ReportTemplate,
} from './insights-ui-types.js';

const { Pool } = pg;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function isPgInsightsUiEnabled(): boolean {
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
    join(here, '../../../db/sql/020_insights_ui_schema.sql'),
    join(process.cwd(), 'db/sql/020_insights_ui_schema.sql'),
    join(process.cwd(), '../../db/sql/020_insights_ui_schema.sql'),
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

function mapTemplate(row: Record<string, unknown>): ReportTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    module: String(row.module),
    format: parseJson(row.format, ['PDF'] as ReportTemplate['format']),
    filters: parseJson(row.filters, [] as ReportTemplate['filters']),
  };
}

function mapRun(row: Record<string, unknown>): ReportRun {
  return {
    id: String(row.id),
    templateId: String(row.template_id),
    templateName: String(row.template_name),
    generatedAt:
      row.generated_at instanceof Date
        ? row.generated_at.toISOString()
        : new Date(String(row.generated_at)).toISOString(),
    generatedBy: String(row.generated_by),
    format: String(row.format) as ReportRun['format'],
    fileSizeKb: Number(row.file_size_kb ?? 0),
    status: String(row.status) as ReportRun['status'],
    downloadUrl: row.download_url == null ? null : String(row.download_url),
  };
}

function mapJob(row: Record<string, unknown>): DwImportJob {
  return {
    id: String(row.id),
    source: String(row.source) as DwImportJob['source'],
    filename: String(row.filename),
    submittedAt:
      row.submitted_at instanceof Date
        ? row.submitted_at.toISOString()
        : new Date(String(row.submitted_at)).toISOString(),
    rows: Number(row.rows ?? 0),
    status: String(row.status) as DwImportJob['status'],
    errorMessage: row.error_message == null ? null : String(row.error_message),
  };
}

function mapIndicator(row: Record<string, unknown>): DwIndicator {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    category: String(row.category),
    unit: String(row.unit),
    latestValue: row.latest_value == null ? null : Number(row.latest_value),
    trend: row.trend == null ? null : (String(row.trend) as DwIndicator['trend']),
    lastUpdated:
      row.last_updated == null
        ? null
        : row.last_updated instanceof Date
          ? row.last_updated.toISOString()
          : new Date(String(row.last_updated)).toISOString(),
  };
}

function mapGeo(row: Record<string, unknown>): DwGeoFeature {
  return {
    institutionId: String(row.institution_id),
    name: String(row.name),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    type: String(row.type),
    enrolment: Number(row.enrolment ?? 0),
  };
}

export interface InsightsUiStore {
  readonly persistence: 'postgres' | 'memory';
  listTemplates(): Promise<ReportTemplate[]>;
  getTemplate(id: string): Promise<ReportTemplate | null>;
  createTemplate(template: ReportTemplate): Promise<ReportTemplate>;
  listRuns(tenantId: string, templateId?: string): Promise<ReportRun[]>;
  createRun(tenantId: string, run: ReportRun): Promise<ReportRun>;
  listIndicators(): Promise<DwIndicator[]>;
  listImportJobs(tenantId: string): Promise<DwImportJob[]>;
  createImportJob(tenantId: string, job: DwImportJob): Promise<DwImportJob>;
  listGeoFeatures(): Promise<DwGeoFeature[]>;
}

class InMemoryInsightsUiStore implements InsightsUiStore {
  readonly persistence = 'memory' as const;
  private readonly templates = new Map<string, ReportTemplate>(
    seedTemplates().map((tpl) => [tpl.id, tpl]),
  );
  private readonly runsByTenant = new Map<string, ReportRun[]>();
  private readonly jobsByTenant = new Map<string, DwImportJob[]>();
  private readonly indicators = seedIndicators();
  private readonly geoFeatures = seedGeoFeatures();

  async listTemplates(): Promise<ReportTemplate[]> {
    return Array.from(this.templates.values());
  }

  async getTemplate(id: string): Promise<ReportTemplate | null> {
    return this.templates.get(id) ?? null;
  }

  async createTemplate(template: ReportTemplate): Promise<ReportTemplate> {
    this.templates.set(template.id, template);
    return template;
  }

  async listRuns(tenantId: string, templateId?: string): Promise<ReportRun[]> {
    let runs = this.runsByTenant.get(tenantId) ?? [];
    if (templateId) runs = runs.filter((run) => run.templateId === templateId);
    return runs;
  }

  async createRun(tenantId: string, run: ReportRun): Promise<ReportRun> {
    const list = this.runsByTenant.get(tenantId) ?? [];
    list.unshift(run);
    this.runsByTenant.set(tenantId, list);
    return run;
  }

  async listIndicators(): Promise<DwIndicator[]> {
    return this.indicators;
  }

  async listImportJobs(tenantId: string): Promise<DwImportJob[]> {
    return this.jobsByTenant.get(tenantId) ?? [];
  }

  async createImportJob(tenantId: string, job: DwImportJob): Promise<DwImportJob> {
    const list = this.jobsByTenant.get(tenantId) ?? [];
    list.unshift(job);
    this.jobsByTenant.set(tenantId, list);
    return job;
  }

  async listGeoFeatures(): Promise<DwGeoFeature[]> {
    return this.geoFeatures;
  }
}

export class PgInsightsUiStore implements InsightsUiStore {
  readonly persistence = 'postgres' as const;
  private catalogSeeded = false;

  constructor(private readonly pool: pg.Pool) {}

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  private async ensureReady(): Promise<void> {
    await ensureSchema(this.pool);
    if (this.catalogSeeded) return;
    this.catalogSeeded = true;
    for (const tpl of seedTemplates()) {
      await this.pool.query(
        `INSERT INTO insights_ui_templates
           (id, name, description, module, format, filters)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          tpl.id,
          tpl.name,
          tpl.description,
          tpl.module,
          JSON.stringify(tpl.format),
          JSON.stringify(tpl.filters),
        ],
      );
    }
    for (const ind of seedIndicators()) {
      await this.pool.query(
        `INSERT INTO insights_ui_indicators
           (id, code, name, category, unit, latest_value, trend, last_updated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          ind.id,
          ind.code,
          ind.name,
          ind.category,
          ind.unit,
          ind.latestValue,
          ind.trend,
          ind.lastUpdated,
        ],
      );
    }
    for (const geo of seedGeoFeatures()) {
      await this.pool.query(
        `INSERT INTO insights_ui_geo_features
           (institution_id, name, latitude, longitude, type, enrolment)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (institution_id) DO NOTHING`,
        [geo.institutionId, geo.name, geo.latitude, geo.longitude, geo.type, geo.enrolment],
      );
    }
  }

  async listTemplates(): Promise<ReportTemplate[]> {
    await this.ensureReady();
    const result = await this.pool.query(`SELECT * FROM insights_ui_templates ORDER BY name ASC`);
    return result.rows.map((row) => mapTemplate(row as Record<string, unknown>));
  }

  async getTemplate(id: string): Promise<ReportTemplate | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      `SELECT * FROM insights_ui_templates WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!result.rows[0]) return null;
    return mapTemplate(result.rows[0] as Record<string, unknown>);
  }

  async createTemplate(template: ReportTemplate): Promise<ReportTemplate> {
    await this.ensureReady();
    const result = await this.pool.query(
      `INSERT INTO insights_ui_templates
         (id, name, description, module, format, filters)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)
       RETURNING *`,
      [
        template.id,
        template.name,
        template.description,
        template.module,
        JSON.stringify(template.format),
        JSON.stringify(template.filters),
      ],
    );
    return mapTemplate(result.rows[0] as Record<string, unknown>);
  }

  async listRuns(tenantId: string, templateId?: string): Promise<ReportRun[]> {
    await this.ensureReady();
    return this.withTenant(tenantId, async (client) => {
      const result = templateId
        ? await client.query(
            `SELECT * FROM insights_ui_runs
             WHERE tenant_id = $1 AND template_id = $2
             ORDER BY generated_at DESC`,
            [tenantId, templateId],
          )
        : await client.query(
            `SELECT * FROM insights_ui_runs
             WHERE tenant_id = $1
             ORDER BY generated_at DESC`,
            [tenantId],
          );
      return result.rows.map((row) => mapRun(row as Record<string, unknown>));
    });
  }

  async createRun(tenantId: string, run: ReportRun): Promise<ReportRun> {
    await this.ensureReady();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO insights_ui_runs
           (id, tenant_id, template_id, template_name, generated_at, generated_by,
            format, file_size_kb, status, download_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          run.id,
          tenantId,
          run.templateId,
          run.templateName,
          run.generatedAt,
          run.generatedBy,
          run.format,
          run.fileSizeKb,
          run.status,
          run.downloadUrl,
        ],
      );
      return mapRun(result.rows[0] as Record<string, unknown>);
    });
  }

  async listIndicators(): Promise<DwIndicator[]> {
    await this.ensureReady();
    const result = await this.pool.query(`SELECT * FROM insights_ui_indicators ORDER BY code ASC`);
    return result.rows.map((row) => mapIndicator(row as Record<string, unknown>));
  }

  async listImportJobs(tenantId: string): Promise<DwImportJob[]> {
    await this.ensureReady();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM insights_ui_import_jobs
         WHERE tenant_id = $1
         ORDER BY submitted_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapJob(row as Record<string, unknown>));
    });
  }

  async createImportJob(tenantId: string, job: DwImportJob): Promise<DwImportJob> {
    await this.ensureReady();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO insights_ui_import_jobs
           (id, tenant_id, source, filename, submitted_at, rows, status, error_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          job.id,
          tenantId,
          job.source,
          job.filename,
          job.submittedAt,
          job.rows,
          job.status,
          job.errorMessage ?? null,
        ],
      );
      return mapJob(result.rows[0] as Record<string, unknown>);
    });
  }

  async listGeoFeatures(): Promise<DwGeoFeature[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      `SELECT * FROM insights_ui_geo_features ORDER BY name ASC`,
    );
    return result.rows.map((row) => mapGeo(row as Record<string, unknown>));
  }
}

export function createInsightsUiStore(options?: { forceMemory?: boolean }): InsightsUiStore {
  if (!options?.forceMemory) {
    const pool = getPool();
    if (pool && isPgInsightsUiEnabled()) {
      return new PgInsightsUiStore(pool);
    }
  }
  return new InMemoryInsightsUiStore();
}
