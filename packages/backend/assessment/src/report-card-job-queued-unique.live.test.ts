/**
 * PRC-M166 (schema residual) — concurrent requests for the same report card share one
 * queued job, on a real, migrated Postgres (runtime app role, RLS enforced).
 *
 * The app-level in-flight reuse (findByStudentAndPeriod, then create) is check-then-insert,
 * so two concurrent requests that both see "no in-flight job" each create one. db/sql/268
 * adds report_card_jobs_queued_card_uidx (tenant_id, student_id, academic_period_id,
 * template_id, institution_id) WHERE status = 'queued'; the losing create gets 23505
 * (ConflictError from the repository) and the service re-reads and reuses the queued job.
 * Limiting the index to `queued` keeps the stale-`processing` → new-job behaviour.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { ConflictError } from '@proctira/common';
import {
  closeSharedPgPools,
  getSharedPgPool,
  withPgTenant,
  type PgPoolWithConnect,
} from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PgInstitutionBrandingRepository,
  PgReportCardJobRepository,
  PgReportCardTemplateRepository,
  PgTeacherCommentRepository,
} from './pg-report-card-repository.js';
import { ReportCardService } from './report-card-service.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'report-card-job-queued-unique.live.test' });

/** Holds every in-flight lookup until `parties` callers have read (or 2 s pass). */
class BarrierJobRepository extends PgReportCardJobRepository {
  private waiting: Array<() => void> = [];
  private armed = true;

  constructor(
    pool: PgPoolWithConnect,
    private readonly parties: number,
  ) {
    super(pool);
  }

  override async findByStudentAndPeriod(tenantId: string, studentId: string, periodId: string) {
    const rows = await super.findByStudentAndPeriod(tenantId, studentId, periodId);
    if (!this.armed) return rows;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      this.waiting.push(() => {
        clearTimeout(timer);
        resolve();
      });
      if (this.waiting.length >= this.parties) {
        this.armed = false;
        const all = this.waiting;
        this.waiting = [];
        all.forEach((go) => go());
      }
    });
    return rows;
  }
}

describe.skipIf(!DATABASE_URL)('PRC-M166 one queued report-card job per card (live)', () => {
  let pool: PgPoolWithConnect;

  beforeAll(() => {
    pool = getSharedPgPool(DATABASE_URL) as PgPoolWithConnect;
  });

  afterAll(async () => {
    await closeSharedPgPools();
  });

  async function fixture(racers = 2) {
    const tenantId = randomUUID();
    const studentId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    await ensurePgTestStudent(pool, tenantId, studentId);
    const templates = new PgReportCardTemplateRepository(pool);
    const template = await templates.create({
      id: randomUUID(),
      tenantId,
      name: 'Term card',
      templateContent: '<h1>{{student.name}}</h1>',
      isDefault: true,
      includeLogo: false,
      includeGradeSummary: true,
      includeComments: false,
    });
    const jobs = new BarrierJobRepository(pool, racers);
    const service = new ReportCardService(
      templates,
      new PgTeacherCommentRepository(pool),
      new PgInstitutionBrandingRepository(pool),
      jobs,
      {} as never, // results: only used when a job is processed
      {} as never, // assessment items: only used when a job is processed
      null, // no queue publisher: jobs stay queued
      null,
    );
    return {
      tenantId,
      service,
      jobs,
      input: {
        studentId,
        academicPeriodId: randomUUID(),
        institutionId: randomUUID(),
        templateId: template.id,
      },
    };
  }

  async function queuedCount(tenantId: string, studentId: string) {
    const res = await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM report_card_jobs
          WHERE tenant_id = $1 AND student_id = $2 AND status = 'queued'`,
        [tenantId, studentId],
      ),
    );
    return (res.rows[0] as { n: number }).n;
  }

  it('two concurrent single-card requests leave one queued job and both get it', async () => {
    const fx = await fixture();
    const [a, b] = await Promise.all([
      fx.service.queueReportCardGeneration(fx.tenantId, fx.input),
      fx.service.queueReportCardGeneration(fx.tenantId, fx.input),
    ]);
    expect(await queuedCount(fx.tenantId, fx.input.studentId)).toBe(1);
    expect(a.id).toBe(b.id);
  });

  it('a second queued row for the same card is rejected by the database', async () => {
    const fx = await fixture(1);
    const first = await fx.service.queueReportCardGeneration(fx.tenantId, fx.input);
    await expect(
      fx.jobs.create({ ...first, id: randomUUID(), errorMessage: null, outputUrl: null }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
