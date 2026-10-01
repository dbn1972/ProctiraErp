/**
 * PRC-L367: uploaded file names are sanitised and downloaded with an RFC 5987
 * Content-Disposition + nosniff; invalid base64 is a 400; WebP needs RIFF.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStudentRepository } from '../in-memory-repository.js';
import { registerStudentRoutes } from '../routes.js';
import { StudentService } from '../student-service.js';
import { InMemoryStudentBlobStore } from './blob-store.js';
import { attachmentDisposition, registerStudents360Routes } from './routes.js';
import {
  decodeBase64Strict,
  decodeDocumentPayload,
  sanitizeFileName,
  Students360Service,
} from './service.js';
import { InMemoryStudents360Store } from './store.js';

const TENANT = randomUUID();
const PDF = Buffer.from('%PDF-1.4 fixture');

describe('upload hardening helpers', () => {
  it('sanitises control characters and path separators', () => {
    expect(sanitizeFileName('a\r\nb.pdf')).toBe('ab.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFileName('\u0000')).toBe('');
  });
  it('rejects malformed base64 instead of silently decoding garbage', () => {
    expect(decodeBase64Strict('not base64!!')).toBeNull();
    expect(decodeBase64Strict('abc')).toBeNull();
    expect(decodeBase64Strict(PDF.toString('base64'))?.equals(PDF)).toBe(true);
    expect(decodeBase64Strict(`data:application/pdf;base64,${PDF.toString('base64')}`)).not.toBe(
      null,
    );
  });
  it('requires RIFF at offset 0 for WebP', () => {
    const fake = Buffer.concat([Buffer.from('XXXX'), Buffer.alloc(4), Buffer.from('WEBP')]);
    const real = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
    const doc = (b: Buffer) => ({
      category: 'other',
      fileName: 'x.webp',
      mimeType: 'image/webp',
      contentBase64: b.toString('base64'),
    });
    expect(() => decodeDocumentPayload(doc(fake) as never)).toThrow(/MIME/);
    expect(decodeDocumentPayload(doc(real) as never).mimeType).toBe('image/webp');
  });
  it('encodes non-Latin1 names via filename*', () => {
    const header = attachmentDisposition('प्रमाण "पत्र".pdf');
    expect(header).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(header).not.toMatch(/[^\x20-\x7e]/);
  });
});

describe('document routes (PRC-L367)', () => {
  let app: FastifyInstance;
  let studentId: string;

  beforeEach(async () => {
    const repo = new InMemoryStudentRepository();
    const service = new Students360Service({
      students: repo,
      store: new InMemoryStudents360Store(),
      blobs: new InMemoryStudentBlobStore(),
    });
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: { sub: string; roles: string[] } }).user = {
        sub: 'actor',
        roles: ['registrar'],
      };
    });
    await registerStudentRoutes(app, { studentService: new StudentService(repo) });
    await registerStudents360Routes(app, { service });
    await app.ready();
    const created = await app.inject({
      method: 'POST',
      url: '/students',
      payload: { firstName: 'A', lastName: 'B', dateOfBirth: '2010-01-01', gender: 'female' },
    });
    studentId = created.json().id as string;
  });
  afterEach(async () => {
    await app.close();
  });

  async function upload(fileName: string, contentBase64 = PDF.toString('base64')) {
    return app.inject({
      method: 'POST',
      url: `/students/${studentId}/documents`,
      payload: { category: 'other', fileName, mimeType: 'application/pdf', contentBase64 },
    });
  }

  it.each(['a\r\nb.pdf', 'प्रमाणपत्र.pdf'])('upload %j then download returns 200', async (name) => {
    const up = await upload(name);
    expect(up.statusCode).toBe(201);
    expect(up.json().fileName).not.toMatch(/[\r\n]/);
    const down = await app.inject({
      method: 'GET',
      url: `/students/${studentId}/documents/${up.json().id}`,
    });
    expect(down.statusCode).toBe(200);
    expect(down.headers['x-content-type-options']).toBe('nosniff');
    expect(String(down.headers['content-disposition'])).toContain("filename*=UTF-8''");
    expect(Buffer.from(down.rawPayload).equals(PDF)).toBe(true);
  });

  it('invalid base64 -> 400', async () => {
    const res = await upload('x.pdf', '%%%not-base64%%%');
    expect(res.statusCode).toBe(400);
  });
});
