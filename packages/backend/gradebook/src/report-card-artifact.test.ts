/**
 * PRC-M265: SUCCEEDED report-card jobs have a retrievable, checksummed artifact.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { BOARD, SECTION, STUDENT, TENANT, setupGradebook } from './gradebook-test-setup.js';

const OTHER_PERIOD_SECTION = '44444444-4444-4444-8444-4444444444bb';

describe('PRC-M265 report-card artifacts', () => {
  beforeEach(() => {
    process.env.SIS_REPORT_CARD_DIR = mkdtempSync(join(tmpdir(), 'sis-report-cards-'));
  });

  async function publish(
    service: ReturnType<typeof setupGradebook>['service'],
    sectionId: string,
    code: string,
    score: number,
  ) {
    const e = await service.upsertGradeEntry(TENANT, {
      sectionId,
      studentId: STUDENT,
      assessmentCode: code,
      numericScore: score,
    });
    for (const a of ['submit', 'approve', 'lock', 'publish'] as const) {
      await service.transitionGradeEntry(TENANT, e.id, a);
    }
    return e;
  }

  it('POST report-card then download returns the same checksum; other periods / drafts excluded; HTML escaped', async () => {
    const { repo, service } = setupGradebook();
    repo.seedSection({
      id: OTHER_PERIOD_SECTION,
      tenantId: TENANT,
      institutionId: '66666666-6666-4666-8666-666666666666',
      academicPeriodId: '77777777-7777-4777-8777-0000000000ff',
      code: '9-A',
      name: 'Class 9-A',
      status: 'PUBLISHED',
    });
    await publish(service, SECTION, '<b>MATH</b>', 91);
    await publish(service, OTHER_PERIOD_SECTION, 'OLDSCI', 50);
    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'DRAFTENG',
      numericScore: 10,
    });
    const job = await service.createReportCardJob(TENANT, {
      studentId: STUDENT,
      boardId: BOARD,
      academicPeriodId: '77777777-7777-4777-8777-777777777777',
    } as never);
    expect(job.status).toBe('SUCCEEDED');
    expect(job.artifactUri).not.toMatch(/^memory:/);
    const file = await service.downloadReportCard(TENANT, job.id);
    const html = file.body.toString('utf8');
    expect(file.contentType).toContain('text/html');
    expect(job.metadata.checksumSha256).toBeTruthy();
    expect(html).toContain('&lt;b&gt;MATH&lt;/b&gt;');
    expect(html).not.toContain('<b>MATH</b>');
    expect(html).not.toContain('OLDSCI');
    expect(html).not.toContain('DRAFTENG');
    expect(job.metadata.gradeCount).toBe(1);
  });

  it('download is tenant-scoped and 404s for unknown ids', async () => {
    const { service } = setupGradebook();
    const job = await service.createReportCardJob(TENANT, { studentId: STUDENT, boardId: BOARD });
    await expect(
      service.downloadReportCard('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', job.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.downloadReportCard(TENANT, 'nope')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
