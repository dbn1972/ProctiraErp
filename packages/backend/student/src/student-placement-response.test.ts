/**
 * PRC-M031 contract: `GET /students` and `GET /students/:id` carry additive
 * placement fields (institutionId, gradeId, grade, classId, className) from the
 * student's current enrollment. The mobile `Student.fromJson` reads `className`
 * and `grade` to filter the attendance roster; before the fix neither existed.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStudentRepository } from './in-memory-repository.js';
import { registerStudentRoutes } from './routes.js';
import type { StudentEntity, StudentPlacement } from './student-repository.js';
import { StudentService } from './student-service.js';

const TENANT_ID = '6f0b6c1e-3b7a-4c55-9d1e-2a4f8b9c0d11';
const PLACED = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const UNPLACED = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const PLACEMENT: StudentPlacement = {
  institutionId: '11111111-1111-4111-8111-111111111111',
  gradeId: '22222222-2222-4222-8222-222222222222',
  gradeName: 'Grade 5',
  classId: '33333333-3333-4333-8333-333333333333',
  className: '5-A',
};

/** In-memory store that resolves placement the way the Prisma repository does. */
class PlacementRepository extends InMemoryStudentRepository {
  private withPlacement(entity: StudentEntity): StudentEntity {
    return { ...entity, placement: entity.id === PLACED ? PLACEMENT : null };
  }
  override async findById(id: string, tenantId: string) {
    const found = await super.findById(id, tenantId);
    return found ? this.withPlacement(found) : null;
  }
  override async list(...args: Parameters<InMemoryStudentRepository['list']>) {
    const page = await super.list(...args);
    return { ...page, data: page.data.map((s) => this.withPlacement(s)) };
  }
}

describe('student placement fields (PRC-M031)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const repository = new PlacementRepository();
    for (const [id, firstName] of [
      [PLACED, 'Asha'],
      [UNPLACED, 'Bina'],
    ] as const) {
      await repository.create({
        id,
        tenantId: TENANT_ID,
        firstName,
        lastName: 'Rao',
        dateOfBirth: '2014-04-18',
        gender: 'female',
        nationalId: null,
        nationality: null,
        contacts: [],
        guardians: [],
        identityDocuments: [],
        customData: {},
      });
    }
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles: ['registrar'] };
    });
    await registerStudentRoutes(app, { studentService: new StudentService(repository) });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /students returns the placement, and nulls for a student with none', async () => {
    const res = await app.inject({ method: 'GET', url: '/students' });
    expect(res.statusCode).toBe(200);
    const byId = new Map(
      (res.json().data as Array<Record<string, unknown>>).map((s) => [s['id'], s]),
    );
    expect(byId.get(PLACED)).toMatchObject({
      institutionId: PLACEMENT.institutionId,
      gradeId: PLACEMENT.gradeId,
      grade: 'Grade 5',
      classId: PLACEMENT.classId,
      className: '5-A',
    });
    expect(byId.get(UNPLACED)).toMatchObject({
      institutionId: null,
      gradeId: null,
      grade: null,
      classId: null,
      className: null,
    });
  });

  it('GET /students/:id returns the placement', async () => {
    const res = await app.inject({ method: 'GET', url: `/students/${PLACED}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ className: '5-A', grade: 'Grade 5' });
  });
});
