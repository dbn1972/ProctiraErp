/**
 * HN-F4-R3: national ID is searchable only by roles allowed to see it.
 *
 * Responses already mask `nationalId` for non-registrar roles (PRC-C010), but the
 * search still matched it, so a teacher or nurse could confirm which student holds
 * a given national ID by searching for it. Registrar/admin keep the match.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { InMemoryStudentRepository } from './in-memory-repository.js';
import { StudentService } from './student-service.js';
import { registerStudentRoutes } from './routes.js';

const TENANT_ID = '6f0b6c1e-3b7a-4c55-9d1e-2a4f8b9c0d11';
const NATIONAL_ID = 'NID-7731-5520';

describe('student search: national ID match is role-gated (HN-F4-R3)', () => {
  let app: FastifyInstance;
  let roles: string[];

  beforeEach(async () => {
    roles = ['registrar'];
    app = Fastify();
    const service = new StudentService(new InMemoryStudentRepository());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles };
    });
    await registerStudentRoutes(app, { studentService: service });
    await app.ready();
    for (const [firstName, nationalId] of [
      ['Zoya', NATIONAL_ID],
      ['Bilal', 'NID-0000-1111'],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/students',
        payload: {
          firstName,
          lastName: 'Khan',
          dateOfBirth: '2012-04-09',
          gender: 'female',
          nationalId,
        },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  const listBy = async (url: string) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return res.json().data as Array<{ firstName: string; nationalId: string | null }>;
  };

  for (const role of ['teacher', 'nurse']) {
    it(`${role}: GET /students?search=<national id> finds nobody`, async () => {
      roles = [role];
      expect(await listBy(`/students?search=${NATIONAL_ID}`)).toEqual([]);
      expect(await listBy('/students?search=7731')).toEqual([]);
    });

    it(`${role}: GET /students/search?q=<national id> finds nobody`, async () => {
      roles = [role];
      expect(await listBy(`/students/search?q=${NATIONAL_ID}`)).toEqual([]);
      expect(await listBy('/students/search?q=7731')).toEqual([]);
    });

    it(`${role}: name search still works and national ID stays masked`, async () => {
      roles = [role];
      const listed = await listBy('/students?search=zoya');
      expect(listed.map((s) => s.firstName)).toEqual(['Zoya']);
      expect(listed[0]!.nationalId).toBeNull();
      const searched = await listBy('/students/search?q=zoya');
      expect(searched.map((s) => s.firstName)).toEqual(['Zoya']);
      expect(searched[0]!.nationalId).toBeNull();
    });
  }

  for (const role of ['registrar', 'admin']) {
    it(`${role}: national ID search still finds the student`, async () => {
      roles = [role];
      const listed = await listBy(`/students?search=${NATIONAL_ID}`);
      expect(listed.map((s) => s.nationalId)).toEqual([NATIONAL_ID]);
      const searched = await listBy('/students/search?q=7731');
      expect(searched.map((s) => s.nationalId)).toEqual([NATIONAL_ID]);
    });
  }
});
