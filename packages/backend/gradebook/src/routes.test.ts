import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gradebookPlugin } from './gradebook-plugin.js';
import { InMemoryGradebookExtrasStore } from './extras-store.js';
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
