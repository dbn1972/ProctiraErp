/**
 * G-717 — Postgres report-card repositories on db/sql/024 (skips without DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import {
  PgInstitutionBrandingRepository,
  PgReportCardJobRepository,
  PgReportCardTemplateRepository,
  PgTeacherCommentRepository,
} from './pg-report-card-repository.js';
import {
  createReportCardJobRepository,
  createReportCardTemplateRepository,
} from './repository-factory.js';
import { InMemoryReportCardTemplateRepository } from './in-memory-report-card-repository.js';

const pool = getSharedPgPool();
const live = pool !== null;

async function seedTenant(tenantId: string): Promise<void> {
  await withPgTenant(pool!, tenantId, (client) =>
    client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `rc-${tenantId.slice(0, 8)}`, `rc-${tenantId}`],
    ),
  );
}

describe('report-card factories (G-717)', () => {
  it('fall back to in-memory when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(createReportCardTemplateRepository()).toBeInstanceOf(
        InMemoryReportCardTemplateRepository,
      );
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });

  it.skipIf(!live)('return Pg repositories when DATABASE_URL is set', () => {
    expect(createReportCardTemplateRepository()).toBeInstanceOf(PgReportCardTemplateRepository);
    expect(createReportCardJobRepository()).toBeInstanceOf(PgReportCardJobRepository);
  });
});

describe.skipIf(!live)('Pg report-card repositories', () => {
  it('persists templates with a single default per tenant and isolates tenants', async () => {
    const repo = new PgReportCardTemplateRepository(pool!);
    const tenantId = randomUUID();
    const otherTenant = randomUUID();
    await seedTenant(tenantId);
    await seedTenant(otherTenant);

    const first = await repo.create({
      id: randomUUID(),
      tenantId,
      name: 'Term card',
      templateContent: '<h1>{{student.name}}</h1>',
      isDefault: true,
      includeLogo: true,
      includeGradeSummary: true,
      includeComments: true,
    });
    const second = await repo.create({
      id: randomUUID(),
      tenantId,
      name: 'Final card',
      templateContent: '<h1>Final</h1>',
      isDefault: true,
      includeLogo: false,
      includeGradeSummary: true,
      includeComments: false,
    });

    expect((await repo.findDefault(tenantId))?.id).toBe(second.id);
    expect((await repo.findById(first.id, tenantId))?.isDefault).toBe(false);
    expect(await repo.list(tenantId)).toHaveLength(2);
    expect(await repo.list(otherTenant)).toHaveLength(0);
    expect(await repo.findById(first.id, otherTenant)).toBeNull();

    const updated = await repo.update(first.id, tenantId, { name: 'Renamed', isDefault: true });
    expect(updated?.name).toBe('Renamed');
    expect((await repo.findDefault(tenantId))?.id).toBe(first.id);

    expect(await repo.delete(second.id, tenantId)).toBe(true);
    expect(await repo.delete(second.id, tenantId)).toBe(false);
  });

  it('upserts teacher comments and branding, tracks job status', async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const comments = new PgTeacherCommentRepository(pool!);
    const branding = new PgInstitutionBrandingRepository(pool!);
    const templates = new PgReportCardTemplateRepository(pool!);
    const jobs = new PgReportCardJobRepository(pool!);

    const studentId = randomUUID();
    const subjectId = randomUUID();
    const periodId = randomUUID();
    const institutionId = randomUUID();

    const c1 = await comments.upsert({
      id: randomUUID(),
      tenantId,
      studentId,
      subjectId,
      academicPeriodId: periodId,
      teacherId: randomUUID(),
      comment: 'Good progress',
    });
    const c2 = await comments.upsert({
      id: randomUUID(),
      tenantId,
      studentId,
      subjectId,
      academicPeriodId: periodId,
      teacherId: randomUUID(),
      comment: 'Excellent progress',
    });
    expect(c2.id).toBe(c1.id);
    expect(c2.comment).toBe('Excellent progress');
    expect(await comments.findByStudentAndPeriod(tenantId, studentId, periodId)).toHaveLength(1);
    expect(
      (await comments.findByStudentSubjectPeriod(tenantId, studentId, subjectId, periodId))
        ?.comment,
    ).toBe('Excellent progress');

    expect(await branding.findByInstitutionId(institutionId, tenantId)).toBeNull();
    await branding.upsert({
      institutionId,
      tenantId,
      name: 'Demo School',
      logoUrl: null,
      address: '1 Main St',
      contactPhone: null,
      contactEmail: 'office@demo.test',
    });
    expect((await branding.findByInstitutionId(institutionId, tenantId))?.name).toBe('Demo School');

    const template = await templates.create({
      id: randomUUID(),
      tenantId,
      name: 'Card',
      templateContent: '<p/>',
      isDefault: true,
      includeLogo: true,
      includeGradeSummary: true,
      includeComments: true,
    });
    const job = await jobs.create({
      id: randomUUID(),
      tenantId,
      studentId,
      academicPeriodId: periodId,
      templateId: template.id,
      institutionId,
      status: 'queued',
      errorMessage: null,
      outputUrl: null,
    });
    const done = await jobs.updateStatus(job.id, tenantId, 'completed', {
      outputUrl: `report-cards/${job.id}.pdf`,
      completedAt: new Date(),
    });
    expect(done?.status).toBe('completed');
    expect(done?.outputUrl).toBe(`report-cards/${job.id}.pdf`);
    expect(done?.completedAt).toBeInstanceOf(Date);
    expect(await jobs.findByStudentAndPeriod(tenantId, studentId, periodId)).toHaveLength(1);
    expect(await jobs.findById(job.id, randomUUID())).toBeNull();
  });
});
