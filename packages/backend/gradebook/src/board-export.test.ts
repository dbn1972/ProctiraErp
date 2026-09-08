import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BusinessRuleError } from '@proctira/common';
import { afterEach, describe, expect, it } from 'vitest';

import { getBoardPack, listBoardPacks } from './board-pack-registry.js';
import { validateBoardExportCompleteness } from './board-export-validation.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';
import { GradebookService } from './gradebook-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TENANT_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOARD = '22222222-2222-4222-8222-222222222222';
const INST = '66666666-6666-4666-8666-666666666666';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const STUDENT_BAD = '33333333-3333-4333-8333-333333333334';

const artifactDirs: string[] = [];

afterEach(() => {
  while (artifactDirs.length > 0) {
    const dir = artifactDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.SIS_BOARD_EXPORT_DIR;
});

describe('board pack registry', () => {
  it('registers CBSE, ICSE, MH-STATE with required subjects', () => {
    const packs = listBoardPacks();
    expect(packs.map((p) => p.code).sort()).toEqual(['CBSE', 'ICSE', 'MH-STATE']);
    expect(getBoardPack('CBSE')?.requiredSubjects).toContain('MATH');
    expect(getBoardPack('ICSE')?.terminology.studentId).toBe('Unique ID');
    expect(getBoardPack('MH-STATE')?.securityMark).toContain('MSBSHSE');
  });

  it('flags incomplete grades', () => {
    const pack = getBoardPack('CBSE')!;
    const result = validateBoardExportCompleteness(pack, [
      {
        studentId: STUDENT,
        firstName: 'A',
        lastName: 'B',
        nationalId: 'N1',
        institutionId: INST,
        grades: [
          { assessmentCode: 'ENG', numericScore: 80, letterGrade: null },
          { assessmentCode: 'MATH', numericScore: 90, letterGrade: null },
        ],
        latestTranscript: null,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.incomplete[0]?.missingSubjects).toEqual(expect.arrayContaining(['SCI', 'SST']));
    }
  });
});

describe('GradebookService board exports', () => {
  function setupComplete() {
    const repo = new InMemoryGradebookRepository();
    repo.seedBoard({ id: BOARD, tenantId: TENANT, code: 'CBSE', name: 'CBSE' });
    repo.seedInstitution({
      id: INST,
      tenantId: TENANT,
      boardId: BOARD,
      code: 'CBSE-DEL-01',
      name: 'CBSE Demo',
    });
    repo.seedBoardCode({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenantId: TENANT,
      boardId: BOARD,
      institutionId: INST,
      codeType: 'AFFILIATION',
      codeValue: 'CBSE-AFF-DEMO',
      label: 'Aff',
    });
    repo.seedBoardCode({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenantId: TENANT,
      boardId: BOARD,
      institutionId: INST,
      codeType: 'CENTRE',
      codeValue: 'CBSE-CTR-DEMO',
      label: 'Ctr',
    });
    repo.seedExportCandidate({
      studentId: STUDENT,
      firstName: 'Student',
      lastName: 'One',
      nationalId: 'NID-1',
      institutionId: INST,
      grades: [
        { assessmentCode: 'ENG', numericScore: 88, letterGrade: null },
        { assessmentCode: 'MATH', numericScore: 95, letterGrade: null },
        { assessmentCode: 'SCI', numericScore: 84, letterGrade: null },
        { assessmentCode: 'SST', numericScore: 79, letterGrade: null },
      ],
      latestTranscript: { version: 1, checksumSha256: 'abc', issuedAt: new Date().toISOString() },
    });
    const dir = mkdtempSync(join(tmpdir(), 'sis-board-exports-'));
    artifactDirs.push(dir);
    process.env.SIS_BOARD_EXPORT_DIR = dir;
    return { service: new GradebookService(repo), repo };
  }

  it('creates MARKSHEET_PACK with filesystem artifacts + checksum', async () => {
    const { service } = setupComplete();
    const job = await service.createBoardExportJob(TENANT, {
      boardId: BOARD,
      institutionId: INST,
      studentIds: [STUDENT],
    });
    expect(job.jobType).toBe('MARKSHEET_PACK');
    expect(job.status).toBe('SUCCEEDED');
    expect(job.artifactUri).toContain('pack.json');
    expect(job.metadata.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(job.metadata.candidateCount).toBe(1);

    const file = await service.downloadBoardExport(TENANT, job.id, 'csv');
    expect(file.contentType).toContain('text/csv');
    expect(file.body.toString('utf8')).toContain('NID-1');
    expect(file.body.toString('utf8')).toContain('CBSE-AFF-DEMO');
  });

  it('rejects incomplete grades with BusinessRuleError (422)', async () => {
    const { service, repo } = setupComplete();
    repo.seedExportCandidate({
      studentId: STUDENT_BAD,
      firstName: 'Incomplete',
      lastName: 'Student',
      nationalId: 'NID-BAD',
      institutionId: INST,
      grades: [{ assessmentCode: 'MATH', numericScore: 40, letterGrade: null }],
      latestTranscript: null,
    });

    await expect(
      service.createBoardExportJob(TENANT, {
        boardCode: 'CBSE',
        institutionId: INST,
        studentIds: [STUDENT_BAD],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('queues async jobs and processes later; signed download is tenant-bound', async () => {
    const { service } = setupComplete();
    const queued = await service.createBoardExportJob(TENANT, {
      boardId: BOARD,
      institutionId: INST,
      studentIds: [STUDENT],
      async: true,
    });
    expect(queued.status).toBe('QUEUED');

    const done = await service.processBoardExportJob(TENANT, queued.id);
    expect(done.status).toBe('SUCCEEDED');

    const signed = service.issueBoardExportDownloadToken(TENANT, done.id, 120);
    const file = await service.downloadBoardExport(TENANT, done.id, 'csv', {
      downloadToken: signed.token,
      actorId: 'registrar-1',
    });
    expect(file.body.toString('utf8')).toContain('NID-1');

    await expect(
      service.downloadBoardExport(TENANT_B, done.id, 'csv'),
    ).rejects.toThrow(/not found/i);

    const audits = service.listAudits(TENANT);
    expect(audits.some((a) => a.action === 'board_export.create')).toBe(true);
    expect(audits.some((a) => a.action === 'board_export.download')).toBe(true);
  });
});
