/**
 * W1-SEC-02 (D3) — negative authz tests for student domain route guards.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStudentRepository } from './in-memory-repository.js';
import { registerStudentRoutes } from './routes.js';
import { StudentService } from './student-service.js';

const TENANT_ID = randomUUID();

function createApp(roles: string[]): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
    (request as unknown as { user: { roles: string[] } }).user = { roles };
  });
  return app;
}

describe('W1-SEC-02 (D3) student route authz', () => {
  let app: FastifyInstance;
  let repository: InMemoryStudentRepository;

  beforeEach(async () => {
    repository = new InMemoryStudentRepository();
    const service = new StudentService(repository);
    app = createApp(['registrar']);
    await registerStudentRoutes(app, { studentService: service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('teacher cannot POST /students (403)', async () => {
    const teacherApp = createApp(['teacher']);
    await registerStudentRoutes(teacherApp, { studentService: new StudentService(repository) });
    await teacherApp.ready();

    const response = await teacherApp.inject({
      method: 'POST',
      url: '/students',
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2005-01-01',
        gender: 'female',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    await teacherApp.close();
  });

  it('teacher cannot PUT /students/:id (403)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/students',
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2005-01-01',
        gender: 'female',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const teacherApp = createApp(['teacher']);
    await registerStudentRoutes(teacherApp, { studentService: new StudentService(repository) });
    await teacherApp.ready();

    const response = await teacherApp.inject({
      method: 'PUT',
      url: `/students/${id}`,
      payload: { firstName: 'Hacked' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    await teacherApp.close();
  });

  it('teacher cannot DELETE /students/:id (403)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/students',
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2005-01-01',
        gender: 'female',
      },
    });
    const id = created.json().id as string;

    const teacherApp = createApp(['teacher']);
    await registerStudentRoutes(teacherApp, { studentService: new StudentService(repository) });
    await teacherApp.ready();

    const response = await teacherApp.inject({
      method: 'DELETE',
      url: `/students/${id}`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    await teacherApp.close();
  });

  it('teacher may GET /students (read allowed)', async () => {
    const teacherApp = createApp(['teacher']);
    await registerStudentRoutes(teacherApp, { studentService: new StudentService(repository) });
    await teacherApp.ready();

    const response = await teacherApp.inject({
      method: 'GET',
      url: '/students',
    });

    expect(response.statusCode).toBe(200);
    await teacherApp.close();
  });

  it('unknown role cannot GET /students (403)', async () => {
    const deniedApp = createApp(['billing_clerk']);
    await registerStudentRoutes(deniedApp, { studentService: new StudentService(repository) });
    await deniedApp.ready();

    const response = await deniedApp.inject({
      method: 'GET',
      url: '/students',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    await deniedApp.close();
  });

  it('registrar may POST /students', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/students',
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2005-01-01',
        gender: 'female',
      },
    });
    expect(response.statusCode).toBe(201);
  });
});
