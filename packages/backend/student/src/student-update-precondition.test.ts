/**
 * PRC-L365: If-Match / updatedAt optimistic-concurrency precondition on
 * PUT /students/:id — stale precondition ⇒ 409, no lost update.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStudentRepository } from './in-memory-repository.js';
import { parseIfMatch, registerStudentRoutes, studentEtag } from './routes.js';
import { StaleStudentUpdateError } from './student-repository.js';
import { StudentService } from './student-service.js';

const TENANT_ID = randomUUID();

describe('PRC-L365 student update precondition', () => {
  let app: FastifyInstance;
  let repository: InMemoryStudentRepository;
  let service: StudentService;

  beforeEach(async () => {
    app = Fastify();
    repository = new InMemoryStudentRepository();
    service = new StudentService(repository);
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles: ['registrar'] };
    });
    await registerStudentRoutes(app, { studentService: service });
    await app.ready();
  });

  async function createStudent(): Promise<{ id: string; etag: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/students',
      payload: { firstName: 'Ana', lastName: 'Lee', dateOfBirth: '2010-01-02', gender: 'female' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const get = await app.inject({ method: 'GET', url: `/students/${id}` });
    expect(get.statusCode).toBe(200);
    return { id, etag: String(get.headers['etag']) };
  }

  it('GET and PUT emit an ETag derived from updatedAt', async () => {
    const { id, etag } = await createStudent();
    const entity = await repository.findById(id, TENANT_ID);
    expect(etag).toBe(studentEtag(entity!.updatedAt));
    const put = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      headers: { 'if-match': etag },
      payload: { firstName: 'Anna' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.headers['etag']).toBe(`"${put.json().updatedAt}"`);
  });

  it('a stale If-Match returns 409 and leaves the record unchanged', async () => {
    const { id, etag } = await createStudent();
    // Writer A wins (fresh precondition, distinct clock tick).
    await new Promise((r) => setTimeout(r, 5));
    const first = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      headers: { 'if-match': etag },
      payload: { firstName: 'Winner' },
    });
    expect(first.statusCode).toBe(200);
    // Writer B still holds the old ETag ⇒ rejected.
    const second = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      headers: { 'if-match': etag },
      payload: { firstName: 'Loser' },
    });
    expect(second.statusCode).toBe(409);
    expect((await repository.findById(id, TENANT_ID))!.firstName).toBe('Winner');
  });

  it('accepts a bare ISO updatedAt and weak ETag; `*` and absent mean unconditional', async () => {
    const { id } = await createStudent();
    const current = (await repository.findById(id, TENANT_ID))!.updatedAt.toISOString();
    const bare = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      headers: { 'if-match': current },
      payload: { lastName: 'One' },
    });
    expect(bare.statusCode).toBe(200);
    const weak = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      headers: { 'if-match': `W/"${bare.json().updatedAt}"` },
      payload: { lastName: 'Two' },
    });
    expect(weak.statusCode).toBe(200);
    const star = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      headers: { 'if-match': '*' },
      payload: { lastName: 'Three' },
    });
    expect(star.statusCode).toBe(200);
    const none = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      payload: { lastName: 'Four' },
    });
    expect(none.statusCode).toBe(200);
  });

  it('a malformed If-Match is rejected with 400 before any write', async () => {
    const { id } = await createStudent();
    const res = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      headers: { 'if-match': '"not-a-timestamp"' },
      payload: { firstName: 'X' },
    });
    expect(res.statusCode).toBe(400);
    expect((await repository.findById(id, TENANT_ID))!.firstName).toBe('Ana');
  });

  it('repository re-checks atomically: a write landing after the service pre-check still 409s', async () => {
    const { id } = await createStudent();
    const before = (await repository.findById(id, TENANT_ID))!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await repository.update(id, TENANT_ID, { firstName: 'Concurrent' });
    await expect(
      repository.update(id, TENANT_ID, { firstName: 'Late' }, { expectedUpdatedAt: before }),
    ).rejects.toBeInstanceOf(StaleStudentUpdateError);
  });

  it('parseIfMatch classifies inputs', () => {
    expect(parseIfMatch(undefined)).toBeUndefined();
    expect(parseIfMatch('*')).toBeUndefined();
    expect(parseIfMatch('"a", "b"')).toBe('invalid');
    expect(parseIfMatch('garbage')).toBe('invalid');
    expect(parseIfMatch('"2024-01-02T03:04:05.006Z"')).toEqual(new Date('2024-01-02T03:04:05.006Z'));
  });
});
