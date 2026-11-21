/**
 * PRC-L446 (topic 3 Option A, in-package guard; the package stays parked):
 * custom-field routes require a verified principal whose tenant claim matches
 * the request tenant, definition writes are admin-only, and value reads/writes
 * on student/staff/institution records are limited to the roles that own
 * those records.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { customFieldPlugin } from './custom-field-plugin.js';
import { CustomFieldService } from './custom-field-service.js';
import {
  InMemoryCustomFieldDefinitionRepository,
  InMemoryCustomFieldValueRepository,
} from './in-memory-repository.js';
import { registerCustomFieldRoutes } from './routes.js';
const TENANT = 'tenant-1';
const STUDENT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
type Principal = { sub?: string; tenantId?: string; roles?: unknown };
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT;
    const header = request.headers['x-test-principal'];
    if (typeof header === 'string') {
      (request as unknown as { user: Principal }).user = JSON.parse(header) as Principal;
    }
  });
  const service = new CustomFieldService(
    new InMemoryCustomFieldDefinitionRepository(),
    new InMemoryCustomFieldValueRepository(),
  );
  await registerCustomFieldRoutes(app, { customFieldService: service });
  await app.ready();
  return app;
}
const as = (p: Principal) => ({ 'x-test-principal': JSON.stringify(p) });
const ADMIN: Principal = { sub: 'admin-1', tenantId: TENANT, roles: ['admin'] };
const REGISTRAR: Principal = { sub: 'reg-1', tenantId: TENANT, roles: ['registrar'] };
const TEACHER: Principal = { sub: 'teacher-1', tenantId: TENANT, roles: ['teacher'] };
const HR: Principal = { sub: 'hr-1', tenantId: TENANT, roles: ['hr_officer'] };
describe('PRC-L446 custom-field in-package authz', () => {
  let app: FastifyInstance;
  let fieldId: string;
  beforeEach(async () => {
    app = await buildApp();
    const def = await app.inject({
      method: 'POST',
      url: '/custom-fields/definitions',
      headers: as(ADMIN),
      payload: { entityType: 'student', fieldKey: 'house', label: 'House', fieldType: 'text' },
    });
    expect(def.statusCode).toBe(201);
    fieldId = (def.json() as { id: string }).id;
  });
  afterEach(async () => {
    await app.close();
  });
  it('401 without an authenticated principal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/custom-fields/values/student/${STUDENT_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });
  it('403 when the token tenant differs from the request tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/custom-fields/values/student/${STUDENT_ID}`,
      headers: as({ ...ADMIN, tenantId: 'tenant-2' }),
    });
    expect(res.statusCode).toBe(403);
  });
  it('a teacher cannot write student custom values (403) and nothing is stored', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/custom-fields/values/student/${STUDENT_ID}`,
      headers: as(TEACHER),
      payload: { values: { [fieldId]: 'Red' } },
    });
    expect(res.statusCode).toBe(403);
    const read = await app.inject({
      method: 'GET',
      url: `/custom-fields/values/student/${STUDENT_ID}`,
      headers: as(ADMIN),
    });
    expect((read.json() as { data: unknown[] }).data).toHaveLength(0);
  });
  it('HR staff cannot read or write student values; registrar can', async () => {
    const hrWrite = await app.inject({
      method: 'PUT',
      url: `/custom-fields/values/student/${STUDENT_ID}`,
      headers: as(HR),
      payload: { values: { [fieldId]: 'Red' } },
    });
    expect(hrWrite.statusCode).toBe(403);
    const hrRead = await app.inject({
      method: 'GET',
      url: `/custom-fields/values/student/${STUDENT_ID}`,
      headers: as(HR),
    });
    expect(hrRead.statusCode).toBe(403);
    const regWrite = await app.inject({
      method: 'PUT',
      url: `/custom-fields/values/student/${STUDENT_ID}`,
      headers: as(REGISTRAR),
      payload: { values: { [fieldId]: 'Red' } },
    });
    expect(regWrite.statusCode).toBe(200);
  });
  it('only admins may create, update or delete definitions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/custom-fields/definitions',
      headers: as(REGISTRAR),
      payload: { entityType: 'student', fieldKey: 'bus', label: 'Bus', fieldType: 'text' },
    });
    expect(res.statusCode).toBe(403);
  });
});
/**
 * Review fix (PRC-L446): the guard must cover the routes whatever the mount
 * path. The gateway mounts domain plugins under a `/api/v1` register prefix,
 * which Fastify folds into `route.url`.
 */
async function buildPrefixedApp(outerPrefix: string): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT;
    const header = request.headers['x-test-principal'];
    if (typeof header === 'string') {
      (request as unknown as { user: Principal }).user = JSON.parse(header) as Principal;
    }
  });
  await app.register(
    async (v1) => {
      await v1.register(customFieldPlugin, {
        definitionRepository: new InMemoryCustomFieldDefinitionRepository(),
        valueRepository: new InMemoryCustomFieldValueRepository(),
      });
    },
    { prefix: outerPrefix },
  );
  await app.ready();
  return app;
}
describe.each(['/api/v1', '/api/v1/'])(
  'PRC-L446 guard under an outer register prefix (%s)',
  (outerPrefix) => {
    let app: FastifyInstance;
    afterEach(async () => {
      await app.close();
    });
    it('401 without an authenticated principal (GET, HEAD, PUT, DELETE)', async () => {
      app = await buildPrefixedApp(outerPrefix);
      const url = `/api/v1/custom-fields/values/student/${STUDENT_ID}`;
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'HEAD', url })).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'PUT', url, payload: { values: { x: 'Red' } } })).statusCode,
      ).toBe(401);
      expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/custom-fields/definitions' })).statusCode,
      ).toBe(401);
    });
    it('403 on tenant mismatch and for a role that does not own the record', async () => {
      app = await buildPrefixedApp(outerPrefix);
      const url = `/api/v1/custom-fields/values/student/${STUDENT_ID}`;
      const mismatch = await app.inject({
        method: 'GET',
        url,
        headers: as({ ...ADMIN, tenantId: 'tenant-2' }),
      });
      expect(mismatch.statusCode).toBe(403);
      const teacher = await app.inject({
        method: 'PUT',
        url,
        headers: as(TEACHER),
        payload: { values: { x: 'Red' } },
      });
      expect(teacher.statusCode).toBe(403);
      const defWrite = await app.inject({
        method: 'POST',
        url: '/api/v1/custom-fields/definitions',
        headers: as(REGISTRAR),
        payload: { entityType: 'student', fieldKey: 'bus', label: 'Bus', fieldType: 'text' },
      });
      expect(defWrite.statusCode).toBe(403);
    });
    it('an authorized principal still reaches the routes under the prefix', async () => {
      app = await buildPrefixedApp(outerPrefix);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/custom-fields/definitions',
        headers: as(ADMIN),
      });
      expect(res.statusCode).toBe(200);
    });
  },
);
