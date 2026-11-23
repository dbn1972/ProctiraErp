/**
 * M4-P2: `POST /gradebook/report-cards` must refuse a student or institution id that does not
 * belong to the caller's tenant, with the #739 safe 422 body (fixed copy, correlation id) and
 * no job row. A foreign-key violation from Postgres never echoes its constraint name.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryGradebookExtrasStore } from './extras-store.js';
import { gradebookPlugin } from './gradebook-plugin.js';
import { BOARD, STUDENT, TENANT, setupGradebook } from './gradebook-test-setup.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';
import { PgGradebookRepository } from './pg-gradebook-repository.js';

const TENANT_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOARD_B = '22222222-2222-4222-8222-2222222222bb';
const STUDENT_OF_B = '33333333-3333-4333-8333-3333333333cc';
const INST_A = '66666666-6666-4666-8666-666666666666';
const INST_B = '66666666-6666-4666-8666-6666666666bb';
const SAFE_BODY = {
  code: 'REFERENCE_NOT_FOUND',
  message: 'A referenced record does not exist.',
  statusCode: 422,
};
const DB_TEXT = /constraint|foreign key|_fkey|_fk\b|violates|relation "|column "|SQLSTATE/i;

beforeEach(() => {
  process.env.SIS_REPORT_CARD_DIR = mkdtempSync(join(tmpdir(), 'm4-p2-report-cards-'));
});

describe('M4-P2 report-card references stay in the tenant (service)', () => {
  function setup() {
    const { repo, service } = setupGradebook();
    repo.seedInstitution({ id: INST_A, tenantId: TENANT, boardId: BOARD, code: 'A', name: 'A' });
    repo.seedBoard({ id: BOARD_B, tenantId: TENANT_B, code: 'CBSE', name: 'CBSE' });
    repo.seedInstitution({
      id: INST_B,
      tenantId: TENANT_B,
      boardId: BOARD_B,
      code: 'B',
      name: 'B',
    });
    repo.seedStudent(TENANT_B, STUDENT_OF_B);
    return { repo, service };
  }

  it("refuses another tenant's student, an unknown student and another tenant's institution", async () => {
    const { service } = setup();
    for (const input of [
      { studentId: STUDENT, boardId: BOARD_B },
      { studentId: '33333333-3333-4333-8333-3333333333dd', boardId: BOARD_B },
      { studentId: 'not-a-uuid', boardId: BOARD_B },
      { studentId: STUDENT_OF_B, boardId: BOARD_B, institutionId: INST_A },
    ]) {
      await expect(
        service.createReportCardJob(TENANT_B, input),
        JSON.stringify(input),
      ).rejects.toMatchObject(SAFE_BODY);
    }
    expect(await service.listReportCardJobs(TENANT_B)).toEqual([]);
    expect(await service.listReportCardJobs(TENANT)).toEqual([]);
  });

  it("still queues a card for the tenant's own student and institution", async () => {
    const { service } = setup();
    const job = await service.createReportCardJob(TENANT_B, {
      studentId: STUDENT_OF_B,
      boardId: BOARD_B,
      institutionId: INST_B,
    });
    expect(job.status).toBe('SUCCEEDED');
    expect(job.institutionId).toBe(INST_B);
    expect(job.metadata.studentId).toBe(STUDENT_OF_B);
  });

  it('an unknown board stays a 404 (PRC-M265), checked before the student', async () => {
    const { service } = setup();
    await expect(
      service.createReportCardJob(TENANT_B, { studentId: STUDENT, boardId: BOARD }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});

describe('M4-P2 report-card references stay in the tenant (route)', () => {
  let app: FastifyInstance;
  let repo: InMemoryGradebookRepository;

  beforeEach(async () => {
    repo = new InMemoryGradebookRepository();
    repo.seedBoard({ id: BOARD_B, tenantId: TENANT_B, code: 'CBSE', name: 'CBSE' });
    repo.seedInstitution({ id: INST_A, tenantId: TENANT, boardId: BOARD, code: 'A', name: 'A' });
    repo.seedStudent(TENANT, STUDENT);
    repo.seedStudent(TENANT_B, STUDENT_OF_B);
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (
        request as FastifyRequest & { user: { tenantId: string; id: string; roles: string[] } }
      ).user = { tenantId: TENANT_B, id: 'admin-b', roles: ['admin'] };
    });
    await app.register(gradebookPlugin, {
      repository: repo,
      extras: new InMemoryGradebookExtrasStore(),
      prefix: '/gradebook',
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it("tenant B gets the safe 422 for tenant A's student or institution, and no job", async () => {
    for (const payload of [
      { studentId: STUDENT, boardId: BOARD_B, institutionId: null },
      { studentId: STUDENT_OF_B, boardId: BOARD_B, institutionId: INST_A },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/gradebook/report-cards', payload });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.body).not.toMatch(DB_TEXT);
      const body = res.json() as Record<string, unknown>;
      expect(body).toMatchObject(SAFE_BODY);
      expect(typeof body.correlationId).toBe('string');
      expect(String(body.correlationId).length).toBeGreaterThan(0);
    }
    const list = await app.inject({ method: 'GET', url: '/gradebook/report-cards' });
    expect(list.json()).toEqual({ data: [] });
  });
});

describe('M4-P2 Postgres foreign-key mapping never echoes a constraint name', () => {
  function fkViolation(constraint: string): Error {
    return Object.assign(
      new Error(`insert or update on table violates foreign key constraint "${constraint}"`),
      { code: '23503', constraint },
    );
  }
  function failingPool(insertError: Error) {
    const client = {
      query: vi.fn(async (text: string) => {
        if (/^\s*INSERT/i.test(text)) throw insertError;
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    return { connect: vi.fn(async () => client), query: vi.fn() };
  }
  const now = new Date().toISOString();
  const job = {
    id: '88888888-8888-4888-8888-888888888888',
    tenantId: TENANT_B,
    boardId: BOARD_B,
    institutionId: INST_A,
    jobType: 'REPORT_CARD',
    status: 'QUEUED',
    requestedBy: null,
    startedAt: null,
    finishedAt: null,
    artifactUri: null,
    errorMessage: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };

  it('a composite tenant FK on board_export_jobs maps to the safe 422', async () => {
    const pgRepo = new PgGradebookRepository(
      failingPool(fkViolation('board_export_jobs_institution_id_tenant_fk')) as never,
    );
    const err = (await pgRepo.createExportJob(job as never).catch((e: unknown) => e)) as Error & {
      code?: string;
      statusCode?: number;
    };
    expect({ code: err.code, statusCode: err.statusCode, message: err.message }).toEqual({
      code: 'REFERENCE_NOT_FOUND',
      statusCode: 422,
      message: 'A referenced record does not exist.',
    });
    expect(JSON.stringify(err)).not.toMatch(DB_TEXT);
  });
});
