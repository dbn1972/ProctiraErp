import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gradebookPlugin } from './gradebook-plugin.js';
import { InMemoryGradebookExtrasStore } from './extras-store.js';
import { GradebookService } from './gradebook-service.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';

describe('gradebook routes G-907', () => {
  let app: FastifyInstance;
  let repo: InMemoryGradebookRepository;

  beforeEach(async () => {
    repo = new InMemoryGradebookRepository();
    repo.seedSection({
      id: SECTION,
      tenantId: TENANT,
      institutionId: '66666666-6666-4666-8666-666666666666',
      academicPeriodId: '77777777-7777-4777-8777-777777777777',
      code: '10-A',
      name: 'Class 10-A',
      status: 'PUBLISHED',
    });
    // PRC-H066: the acting teacher is assigned to SECTION and STUDENT is enrolled in it.
    repo.seedSectionTeacher({
      tenantId: TENANT,
      sectionId: SECTION,
      staffId: 'staff-actor-1',
      principalId: 'actor-1',
    });
    repo.seedSectionEnrollment({ tenantId: TENANT, sectionId: SECTION, studentId: STUDENT });
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      const rolesHeader = request.headers['x-roles'];
      const roles = typeof rolesHeader === 'string' ? rolesHeader.split(',') : ['admin'];
      (
        request as FastifyRequest & { user: { tenantId: string; id: string; roles: string[] } }
      ).user = {
        tenantId: TENANT,
        id: 'actor-1',
        roles,
      };
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

  async function putEntry() {
    const res = await app.inject({
      method: 'PUT',
      url: '/gradebook/entries',
      headers: { 'x-roles': 'teacher' },
      payload: {
        sectionId: SECTION,
        studentId: STUDENT,
        assessmentCode: 'MATH',
        numericScore: 95,
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { id: string };
  }

  it('denies TEACHER approve (grade.moderate)', async () => {
    const entry = await putEntry();
    const submitted = await app.inject({
      method: 'POST',
      url: `/gradebook/entries/${entry.id}/transition`,
      headers: { 'x-roles': 'teacher' },
      payload: { action: 'submit' },
    });
    expect(submitted.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'POST',
      url: `/gradebook/entries/${entry.id}/transition`,
      headers: { 'x-roles': 'teacher' },
      payload: { action: 'approve' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('submit → approve → lock → publish then GET /published', async () => {
    const entry = await putEntry();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/gradebook/entries/${entry.id}/transition`,
          headers: { 'x-roles': 'teacher' },
          payload: { action: 'submit' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/gradebook/entries/${entry.id}/transition`,
          headers: { 'x-roles': 'registrar' },
          payload: { action: 'approve' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/gradebook/entries/${entry.id}/transition`,
          headers: { 'x-roles': 'registrar' },
          payload: { action: 'lock' },
        })
      ).statusCode,
    ).toBe(200);
    const published = await app.inject({
      method: 'POST',
      url: `/gradebook/entries/${entry.id}/transition`,
      headers: { 'x-roles': 'registrar' },
      payload: { action: 'publish' },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().metadata.published).toBe(true);
    expect(published.json().publishedAt).toBeTruthy();

    const listed = await app.inject({
      method: 'GET',
      url: `/gradebook/published?studentId=${STUDENT}`,
      headers: { 'x-roles': 'teacher' },
    });
    expect(listed.statusCode).toBe(200);
    const rows = listed.json().data as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toContain(entry.id);
  });

  describe('SEC-2 tenant resolution', () => {
    it('rejects a request that only supplies x-tenant-id via header (no user.tenantId, no request.tenantId)', async () => {
      await app.close();
      app = Fastify({ logger: false });
      // Deliberately do NOT set user.tenantId/request.tenantId, to simulate a
      // request that never went through a trusted tenant-resolution hook.
      app.addHook('onRequest', async (request) => {
        (request as FastifyRequest & { user: { id: string; roles: string[] } }).user = {
          id: 'actor-1',
          roles: ['admin'],
        };
      });
      await app.register(gradebookPlugin, {
        repository: repo,
        extras: new InMemoryGradebookExtrasStore(),
        prefix: '/gradebook',
      });
      await app.ready();

      const response = await app.inject({
        method: 'PUT',
        url: '/gradebook/entries',
        headers: { 'x-tenant-id': TENANT },
        payload: {
          sectionId: SECTION,
          studentId: STUDENT,
          assessmentCode: 'MATH',
          numericScore: 95,
        },
      });

      // Must NOT resolve a tenant from the header and proceed (200); it must
      // fail the tenant-context check.
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  it('returns an actionable 503 when production transcript signing keys are missing', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousSecret = process.env.TRANSCRIPT_SIGNING_SECRET;
    const previousKms = process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
    process.env.NODE_ENV = 'production';
    delete process.env.TRANSCRIPT_SIGNING_SECRET;
    delete process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/gradebook/transcripts/issue',
        headers: { 'x-roles': 'registrar' },
        payload: { studentId: STUDENT },
      });
      expect(response.statusCode).toBe(503);
      const body = response.json() as { code: string; message: string; statusCode: number };
      expect(body.code).toBe('TRANSCRIPT_SIGNING_KEY_MISSING');
      expect(body.statusCode).toBe(503);
      expect(body.message).toMatch(/TRANSCRIPT_SIGNING_SECRET/);
      expect(body.message).toMatch(/TRANSCRIPT_SIGNING_KMS_KEY_REF/);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousSecret === undefined) delete process.env.TRANSCRIPT_SIGNING_SECRET;
      else process.env.TRANSCRIPT_SIGNING_SECRET = previousSecret;
      if (previousKms === undefined) delete process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
      else process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = previousKms;
    }
  });

  // PRC-C006: read routes must reject unrelated readers and scope portal readers.
  describe('PRC-C006 read authorization', () => {
    it('denies a student on staff-only reads (audits, board-exports, credit-rules, rank, sections)', async () => {
      for (const url of [
        '/gradebook/audits',
        '/gradebook/board-exports',
        '/gradebook/credit-rules',
        `/gradebook/rank?sectionId=${SECTION}`,
        '/gradebook/sections',
        '/gradebook/report-cards',
      ]) {
        const res = await app.inject({ method: 'GET', url, headers: { 'x-roles': 'student' } });
        expect(res.statusCode, `student GET ${url}`).toBe(403);
      }
    });

    it('denies a portal reader on self-scopable reads when no studentBinding is configured', async () => {
      // The default app has no studentBinding → portal reader fails closed.
      const res = await app.inject({
        method: 'GET',
        url: `/gradebook/gpa?studentId=${STUDENT}`,
        headers: { 'x-roles': 'parent' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('staff can still read (regression guard)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/gradebook/audits',
        headers: { 'x-roles': 'registrar' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('binds a portal reader to their linked students on /gpa and /published', async () => {
      await app.close();
      const OTHER_STUDENT = '99999999-9999-4999-8999-999999999999';
      app = Fastify({ logger: false });
      app.addHook('onRequest', async (request) => {
        const rolesHeader = request.headers['x-roles'];
        const roles = typeof rolesHeader === 'string' ? rolesHeader.split(',') : ['admin'];
        (
          request as FastifyRequest & { user: { tenantId: string; id: string; roles: string[] } }
        ).user = { tenantId: TENANT, id: 'parent-1', roles };
      });
      await app.register(gradebookPlugin, {
        repository: repo,
        extras: new InMemoryGradebookExtrasStore(),
        prefix: '/gradebook',
        // Parent is linked only to STUDENT.
        studentBinding: { listReadableStudentIds: async () => [STUDENT] },
      });
      await app.ready();

      // Own child → 200.
      const own = await app.inject({
        method: 'GET',
        url: `/gradebook/gpa?studentId=${STUDENT}`,
        headers: { 'x-roles': 'parent' },
      });
      expect(own.statusCode).toBe(200);

      // Another student → 403.
      const other = await app.inject({
        method: 'GET',
        url: `/gradebook/gpa?studentId=${OTHER_STUDENT}`,
        headers: { 'x-roles': 'parent' },
      });
      expect(other.statusCode).toBe(403);

      // /published for own child → 200; other child → 403.
      const ownPublished = await app.inject({
        method: 'GET',
        url: `/gradebook/published?studentId=${STUDENT}`,
        headers: { 'x-roles': 'parent' },
      });
      expect(ownPublished.statusCode).toBe(200);
      const otherPublished = await app.inject({
        method: 'GET',
        url: `/gradebook/published?studentId=${OTHER_STUDENT}`,
        headers: { 'x-roles': 'parent' },
      });
      expect(otherPublished.statusCode).toBe(403);

      // A portal reader passing only sectionId (no studentId) cannot get a whole section.
      const sectionOnly = await app.inject({
        method: 'GET',
        url: `/gradebook/entries?sectionId=${SECTION}`,
        headers: { 'x-roles': 'parent' },
      });
      expect(sectionOnly.statusCode).toBe(403);

      // A foreign transcript id returns 404 (not 403) so ids cannot be probed.
      const foreignTranscript = await app.inject({
        method: 'GET',
        url: `/gradebook/transcripts/${OTHER_STUDENT}`,
        headers: { 'x-roles': 'parent' },
      });
      expect(foreignTranscript.statusCode).toBe(404);
    });
  });

  // PRC-C007: board-export download requires a staff read role (was open with a decorative token).
  it('PRC-C007: denies board-export download without a staff role', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/gradebook/board-exports/${SECTION}/download`,
      headers: { 'x-roles': 'student' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('issues a transcript when the dedicated signing secret is configured', async () => {
    const previousDir = process.env.SIS_TRANSCRIPT_DIR;
    const previousSecret = process.env.TRANSCRIPT_SIGNING_SECRET;
    const previousKms = process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
    process.env.SIS_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), 'transcript-issue-'));
    process.env.TRANSCRIPT_SIGNING_SECRET = 'route-test-dedicated-transcript-secret';
    process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = 'env:TRANSCRIPT_SIGNING_SECRET';
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/gradebook/transcripts/issue',
        headers: { 'x-roles': 'registrar' },
        payload: { studentId: STUDENT },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        status: string;
        signatureHmac: string;
        metadata: { kmsKeyRef?: string; signingKeyId?: string };
      };
      expect(body.status).toBe('ISSUED');
      expect(body.signatureHmac).toMatch(/^[a-f0-9]{64}$/);
      expect(body.metadata.kmsKeyRef).toBe('env:TRANSCRIPT_SIGNING_SECRET');
      expect(body.metadata.signingKeyId).toBe('transcript-default');
    } finally {
      if (previousDir === undefined) delete process.env.SIS_TRANSCRIPT_DIR;
      else process.env.SIS_TRANSCRIPT_DIR = previousDir;
      if (previousSecret === undefined) delete process.env.TRANSCRIPT_SIGNING_SECRET;
      else process.env.TRANSCRIPT_SIGNING_SECRET = previousSecret;
      if (previousKms === undefined) delete process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF;
      else process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = previousKms;
    }
  });
});

// PRC-L561: HTTP-level proof for cross-tenant downloads, path-traversal ids and
// portal /entries scoping. Concurrency is covered by grade-entry-concurrency.test.ts.
describe('PRC-L561 gradebook download and portal read authorization', () => {
  const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const BOARD = '22222222-2222-4222-8222-222222222222';
  const INST = '66666666-6666-4666-8666-666666666666';
  const OTHER_STUDENT = '99999999-9999-4999-8999-999999999999';
  const ENV_KEYS = [
    'SIS_REPORT_CARD_DIR',
    'SIS_TRANSCRIPT_DIR',
    'SIS_BOARD_EXPORT_DIR',
    'TRANSCRIPT_SIGNING_SECRET',
    'TRANSCRIPT_SIGNING_KMS_KEY_REF',
  ] as const;
  let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  let repo: InMemoryGradebookRepository;
  let extras: InMemoryGradebookExtrasStore;
  const apps: FastifyInstance[] = [];

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.SIS_REPORT_CARD_DIR = mkdtempSync(join(tmpdir(), 'l561-report-cards-'));
    process.env.SIS_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), 'l561-transcripts-'));
    process.env.SIS_BOARD_EXPORT_DIR = mkdtempSync(join(tmpdir(), 'l561-board-exports-'));
    process.env.TRANSCRIPT_SIGNING_SECRET = 'l561-route-test-transcript-secret';
    process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = 'env:TRANSCRIPT_SIGNING_SECRET';

    repo = new InMemoryGradebookRepository();
    extras = new InMemoryGradebookExtrasStore();
    repo.seedSection({
      id: SECTION,
      tenantId: TENANT,
      institutionId: INST,
      academicPeriodId: '77777777-7777-4777-8777-777777777777',
      code: '10-A',
      name: 'Class 10-A',
      status: 'PUBLISHED',
    });
    repo.seedBoard({ id: BOARD, tenantId: TENANT, code: 'CBSE', name: 'CBSE' });
    repo.seedInstitution({
      id: INST,
      tenantId: TENANT,
      boardId: BOARD,
      code: 'CBSE-DEL-01',
      name: 'CBSE Demo',
    });
    for (const [id, codeType, codeValue] of [
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'AFFILIATION', 'CBSE-AFF-L561'],
      ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'CENTRE', 'CBSE-CTR-L561'],
    ] as const) {
      repo.seedBoardCode({
        id,
        tenantId: TENANT,
        boardId: BOARD,
        institutionId: INST,
        codeType,
        codeValue,
        label: codeType,
      });
    }
    repo.seedExportCandidate({
      studentId: STUDENT,
      firstName: 'Student',
      lastName: 'One',
      nationalId: 'NID-L561',
      institutionId: INST,
      grades: [
        { assessmentCode: 'ENG', numericScore: 88, letterGrade: null },
        { assessmentCode: 'MATH', numericScore: 95, letterGrade: null },
        { assessmentCode: 'SCI', numericScore: 84, letterGrade: null },
        { assessmentCode: 'SST', numericScore: 79, letterGrade: null },
      ],
      latestTranscript: null,
    });
  });

  afterEach(async () => {
    while (apps.length > 0) await apps.pop()!.close();
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** App on the shared repository whose caller belongs to `tenantId`. */
  async function appFor(
    tenantId: string,
    roles: string[],
    studentBinding?: { listReadableStudentIds: () => Promise<string[]> },
  ): Promise<FastifyInstance> {
    const instance = Fastify({ logger: false });
    instance.addHook('onRequest', async (request) => {
      (
        request as FastifyRequest & { user: { tenantId: string; id: string; roles: string[] } }
      ).user = { tenantId, id: 'actor-l561', roles };
    });
    await instance.register(gradebookPlugin, {
      repository: repo,
      extras,
      prefix: '/gradebook',
      studentBinding,
    });
    await instance.ready();
    apps.push(instance);
    return instance;
  }

  /** Tenant A artifacts: a report card, a transcript and a board export. */
  async function produceTenantAArtifacts(staffA: FastifyInstance) {
    const card = await staffA.inject({
      method: 'POST',
      url: '/gradebook/report-cards',
      payload: { studentId: STUDENT, boardId: BOARD },
    });
    expect(card.statusCode, card.body).toBe(201);
    const transcript = await staffA.inject({
      method: 'POST',
      url: '/gradebook/transcripts/issue',
      payload: { studentId: STUDENT },
    });
    expect(transcript.statusCode, transcript.body).toBe(201);
    const exportJob = await staffA.inject({
      method: 'POST',
      url: '/gradebook/board-exports',
      payload: { boardId: BOARD, institutionId: INST, studentIds: [STUDENT] },
    });
    expect(exportJob.statusCode, exportJob.body).toBe(201);
    return [
      `/gradebook/report-cards/${(card.json() as { id: string }).id}/download`,
      `/gradebook/transcripts/${(transcript.json() as { id: string }).id}/download`,
      `/gradebook/board-exports/${(exportJob.json() as { id: string }).id}/download?format=csv`,
    ];
  }

  it('another tenant cannot download tenant A report cards, transcripts or board exports', async () => {
    const staffA = await appFor(TENANT, ['admin']);
    const staffB = await appFor(TENANT_B, ['admin']);
    const urls = await produceTenantAArtifacts(staffA);

    for (const url of urls) {
      const own = await staffA.inject({ method: 'GET', url });
      expect(own.statusCode, `tenant A ${url}`).toBe(200);
      expect(own.rawPayload.length).toBeGreaterThan(0);

      const foreign = await staffB.inject({ method: 'GET', url });
      expect(foreign.statusCode, `tenant B ${url}`).toBe(404);
      expect(foreign.headers['content-disposition']).toBeUndefined();
      expect(foreign.body).not.toContain('NID-L561');
    }
  });

  it('path-traversal ids on the download routes never return a file', async () => {
    const staffA = await appFor(TENANT, ['admin']);
    await produceTenantAArtifacts(staffA);
    const ids = ['..%2F..%2F..%2Fetc%2Fpasswd', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', '..', '....%2F'];
    for (const id of ids) {
      for (const url of [
        `/gradebook/report-cards/${id}/download`,
        `/gradebook/transcripts/${id}/download`,
        `/gradebook/board-exports/${id}/download?format=csv`,
      ]) {
        const res = await staffA.inject({ method: 'GET', url });
        expect([400, 404], `${url} -> ${res.statusCode}`).toContain(res.statusCode);
        expect(res.headers['content-disposition']).toBeUndefined();
        expect(res.body).not.toContain('root:');
      }
    }
  });

  it('portal /entries is bound to linked students and shows only published grades', async () => {
    // Seed one published and one draft grade for STUDENT (no actor: seeding only).
    const seeding = new GradebookService(repo, extras);
    const published = await seeding.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'MATH',
      numericScore: 91,
    });
    for (const action of ['submit', 'approve', 'lock', 'publish'] as const) {
      await seeding.transitionGradeEntry(TENANT, published.id, action);
    }
    await seeding.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'ENG',
      numericScore: 40,
    });

    const parent = await appFor(TENANT, ['parent'], {
      listReadableStudentIds: async () => [STUDENT],
    });
    const unlinked = await parent.inject({
      method: 'GET',
      url: `/gradebook/entries?studentId=${OTHER_STUDENT}`,
    });
    expect(unlinked.statusCode).toBe(403);

    const linked = await parent.inject({
      method: 'GET',
      url: `/gradebook/entries?studentId=${STUDENT}`,
    });
    expect(linked.statusCode).toBe(200);
    const rows = (linked.json() as { data: Array<{ id: string; assessmentCode: string }> }).data;
    expect(rows.map((r) => r.id)).toEqual([published.id]);

    // Staff still see the draft as well (regression guard for the filter).
    const staff = await appFor(TENANT, ['registrar']);
    const all = await staff.inject({
      method: 'GET',
      url: `/gradebook/entries?studentId=${STUDENT}`,
    });
    expect((all.json() as { data: unknown[] }).data).toHaveLength(2);
  });
});
