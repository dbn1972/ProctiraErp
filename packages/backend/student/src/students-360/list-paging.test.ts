/**
 * PRC-L368: documents / discipline lists honour limit+offset (max 100) and
 * share a consistent { data, total, limit, offset } envelope.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStudentRepository } from '../in-memory-repository.js';
import { registerStudentRoutes } from '../routes.js';
import { StudentService } from '../student-service.js';
import { InMemoryStudentBlobStore } from './blob-store.js';
import { registerStudents360Routes } from './routes.js';
import { Students360Service } from './service.js';
import { InMemoryStudents360Store, PgStudents360Store } from './store.js';

const TENANT = randomUUID();
const PDF_B64 = Buffer.from('%PDF-1.4 x').toString('base64');

describe('students-360 list paging (PRC-L368)', () => {
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
      payload: { firstName: 'A', lastName: 'B', dateOfBirth: '2010-01-01', gender: 'male' },
    });
    studentId = created.json().id as string;
    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'POST',
        url: `/students/${studentId}/documents`,
        payload: {
          category: 'other',
          fileName: `d${i}.pdf`,
          mimeType: 'application/pdf',
          contentBase64: PDF_B64,
        },
      });
    }
  });
  afterEach(async () => {
    await app.close();
  });

  it('documents: limit/offset honoured with total', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/students/${studentId}/documents?limit=2&offset=1`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body).toMatchObject({ total: 3, limit: 2, offset: 1 });
  });

  it('discipline uses the same envelope', async () => {
    const res = await app.inject({ method: 'GET', url: `/students/${studentId}/discipline` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], total: 0, limit: 50, offset: 0 });
  });

  it.each(['limit=0', 'limit=101', 'limit=abc', 'offset=-1'])('rejects %s with 400', async (q) => {
    const res = await app.inject({ method: 'GET', url: `/students/${studentId}/documents?${q}` });
    expect(res.statusCode).toBe(400);
  });

  it('pg store pushes LIMIT/OFFSET into SQL', async () => {
    const texts: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        texts.push({ text, values });
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const store = new PgStudents360Store({
      connect: vi.fn(async () => client),
      query: vi.fn(),
    } as never);
    const out = await store.listDocuments(TENANT, randomUUID(), { limit: 10, offset: 0 });
    expect(out).toEqual({ data: [], total: 0 });
    const q = texts.find((t) => t.text.includes('FROM student_documents'));
    expect(q?.text).toMatch(/LIMIT \$3 OFFSET \$4/);
    expect(q?.values?.slice(2)).toEqual([10, 0]);
  });
});
