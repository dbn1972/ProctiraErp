/**
 * PRC-M528: the LMS file download sends an RFC 6266/5987 Content-Disposition
 * (quote-safe ASCII fallback + UTF-8 `filename*`) and `X-Content-Type-Options:
 * nosniff`, so a user-chosen filename can neither break the header nor crash
 * the response, and the browser never content-sniffs the attachment.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import { lmsPlugin } from './lms-plugin.js';

const TENANT = randomUUID();
const SCHOOL = randomUUID();

interface Principal {
  sub: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string }>;
  institutions: string[];
}

const teacher: Principal = {
  sub: randomUUID(),
  roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: 'root' }],
  institutions: [SCHOOL],
};

function createApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null as unknown as Principal);
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = String(request.headers['x-tenant-id']);
    (request as unknown as { user: Principal }).user = JSON.parse(
      String(request.headers['x-test-principal']),
    ) as Principal;
  });
  return app;
}

function as(principal: Principal) {
  return { 'x-tenant-id': TENANT, 'x-test-principal': JSON.stringify(principal) };
}

describe('PRC-M528 — LMS file download headers', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = createApp();
    await app.register(lmsPlugin, { repository: new InMemoryLmsRepository() });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  async function uploadAndDownload(filename: string) {
    const assignment = await app.inject({
      method: 'POST',
      url: '/lms/assignments',
      headers: as(teacher),
      payload: {
        scope: 'school',
        institutionId: SCHOOL,
        kind: 'homework',
        title: 'Reading log',
        subject: 'English',
      },
    });
    expect(assignment.statusCode).toBe(201);
    const pdf = Buffer.from('%PDF-1.4\n%test\n', 'utf8');
    const uploaded = await app.inject({
      method: 'POST',
      url: `/lms/assignments/${(assignment.json() as { id: string }).id}/files`,
      headers: as(teacher),
      payload: { filename, mimeType: 'application/pdf', contentBase64: pdf.toString('base64') },
    });
    expect(uploaded.statusCode).toBe(201);
    const fileId = (uploaded.json() as { id: string }).id;
    const signed = await app.inject({
      method: 'POST',
      url: `/lms/files/${fileId}/signed-download`,
      headers: as(teacher),
    });
    expect(signed.statusCode).toBe(200);
    const { token } = signed.json() as { token: string };
    return app.inject({
      method: 'GET',
      url: `/lms/files/${fileId}/download?token=${encodeURIComponent(token)}`,
      headers: as(teacher),
    });
  }

  it('serves a non-Latin-1 filename with quotes safely and with nosniff', async () => {
    const res = await uploadAndDownload('отчёт "q".pdf');
    expect(res.statusCode).toBe(200);
    const disposition = String(res.headers['content-disposition']);
    const fallback = /filename="([^"]*)"/.exec(disposition);
    expect(fallback).not.toBeNull();
    expect(fallback![1]).not.toMatch(/["\\]/);
    expect(fallback![1]).toMatch(/^[\x20-\x7e]+$/);
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('отчёт "q".pdf')}`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('cannot inject extra header parameters through the filename', async () => {
    const res = await uploadAndDownload('a.pdf"; filename="evil.html');
    expect(res.statusCode).toBe(200);
    const disposition = String(res.headers['content-disposition']);
    // Exactly one quoted filename parameter plus the encoded filename*.
    expect(disposition.match(/filename="/g)).toHaveLength(1);
    expect(disposition).not.toContain('filename="evil.html"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
