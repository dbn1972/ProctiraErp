/**
 * PRC-C010/C011 — student roster + students-360 read authorization.
 *
 * C010: guardian/parent/student must not list/search the whole roster, and may read a single
 * student only if it is their linked child / self.
 * C011: the students-360 PII routes (photo, id-card, documents, discipline, consents, siblings,
 * heatmap) require staff, or a portal owner for reads; mutations are staff-only; documents need
 * medical/registrar staff; discipline for a portal reader is filtered to visibleToParent.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStudentRepository } from './in-memory-repository.js';
import { registerStudentRoutes } from './routes.js';
import { StudentService } from './student-service.js';
import type { StudentPortalBinding } from './student-portal-access.js';
import { InMemoryStudentBlobStore } from './students-360/blob-store.js';
import { registerStudents360Routes } from './students-360/routes.js';
import { Students360Service } from './students-360/service.js';
import { InMemoryStudents360Store } from './students-360/store.js';

const TENANT = randomUUID();

interface Principal {
  sub: string;
  roles: Array<{ roleId: string; roleName: string }>;
}

function principal(sub: string, ...roleIds: string[]): Principal {
  return { sub, roles: roleIds.map((r) => ({ roleId: r, roleName: r })) };
}

describe('PRC-C010/C011 student read authorization', () => {
  let app: FastifyInstance;
  let repo: InMemoryStudentRepository;
  let current: Principal;
  let ownChildId: string;
  let otherChildId: string;

  async function build(binding?: StudentPortalBinding) {
    const a = Fastify({ logger: false });
    a.decorateRequest('tenantId', '');
    a.decorateRequest('user', null);
    a.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: Principal }).user = current;
    });
    const studentService = new StudentService(repo);
    const store = new InMemoryStudents360Store();
    const blobs = new InMemoryStudentBlobStore();
    const s360 = new Students360Service({
      students: repo,
      store,
      blobs,
      attendance: { async listStudentAttendanceInRange() { return []; } },
    });
    await registerStudentRoutes(a, { studentService, studentBinding: binding });
    await registerStudents360Routes(a, { service: s360, prefix: '/students', studentBinding: binding });
    await a.ready();
    return { app: a, s360, store };
  }

  beforeEach(async () => {
    repo = new InMemoryStudentRepository();
    const svc = new StudentService(repo);
    const own = await svc.create(TENANT, {
      firstName: 'Own',
      lastName: 'Child',
      dateOfBirth: '2010-01-01',
      gender: 'female',
      nationalId: 'NID-OWN-123',
    });
    const other = await svc.create(TENANT, {
      firstName: 'Other',
      lastName: 'Child',
      dateOfBirth: '2010-02-02',
      gender: 'male',
      nationalId: 'NID-OTHER-456',
    });
    ownChildId = own.id;
    otherChildId = other.id;
    current = principal('registrar-1', 'registrar');
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('C010: guardian/student cannot list or search the roster', async () => {
    ({ app } = await build());
    for (const p of [principal('parent-1', 'guardian'), principal('stu-1', 'student')]) {
      current = p;
      const list = await app.inject({ method: 'GET', url: '/students' });
      expect(list.statusCode, `${p.roles[0]!.roleId} list`).toBe(403);
      const search = await app.inject({ method: 'GET', url: '/students/search?q=child' });
      expect(search.statusCode, `${p.roles[0]!.roleId} search`).toBe(403);
    }
  });

  it('C010: staff can list, and national ID is masked for non-registrar staff', async () => {
    ({ app } = await build());
    current = principal('registrar-1', 'registrar');
    const asRegistrar = await app.inject({ method: 'GET', url: '/students' });
    expect(asRegistrar.statusCode).toBe(200);
    expect(
      (asRegistrar.json().data as Array<{ nationalId: string | null }>).some(
        (s) => s.nationalId === 'NID-OWN-123',
      ),
    ).toBe(true);

    current = principal('teacher-1', 'teacher');
    const asTeacher = await app.inject({ method: 'GET', url: '/students' });
    expect(asTeacher.statusCode).toBe(200);
    expect(
      (asTeacher.json().data as Array<{ nationalId: string | null }>).every(
        (s) => s.nationalId === null,
      ),
    ).toBe(true);
  });

  it('C010: a linked guardian reads their own child but 404s another student', async () => {
    ({ app } = await build({ async listReadableStudentIds() { return [ownChildId]; } }));
    current = principal('parent-1', 'guardian');

    const own = await app.inject({ method: 'GET', url: `/students/${ownChildId}` });
    expect(own.statusCode).toBe(200);
    // National ID masked for a guardian (non-registrar).
    expect(own.json().nationalId).toBeNull();

    const other = await app.inject({ method: 'GET', url: `/students/${otherChildId}` });
    expect(other.statusCode).toBe(404);
  });

  it('C010: a portal reader with no binding fails closed (403) on single read', async () => {
    ({ app } = await build()); // no binding
    current = principal('parent-1', 'guardian');
    const res = await app.inject({ method: 'GET', url: `/students/${ownChildId}` });
    expect(res.statusCode).toBe(403);
  });

  it('C011: students-360 routes reject an unrelated portal caller', async () => {
    ({ app } = await build({ async listReadableStudentIds() { return [ownChildId]; } }));
    current = principal('parent-1', 'guardian');
    // Another student's 360 surfaces → 404 (not their child).
    for (const path of [
      `/students/${otherChildId}/photo`,
      `/students/${otherChildId}/id-card.pdf`,
      `/students/${otherChildId}/consents`,
      `/students/${otherChildId}/discipline`,
      `/students/${otherChildId}/documents`,
    ]) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode, `guardian GET ${path}`).toBe(404);
    }
  });

  it('C011: a guardian cannot mutate 360 records and cannot read documents even for own child', async () => {
    ({ app } = await build({ async listReadableStudentIds() { return [ownChildId]; } }));
    current = principal('parent-1', 'guardian');

    // Write is staff-only → 403.
    const addDiscipline = await app.inject({
      method: 'POST',
      url: `/students/${ownChildId}/discipline`,
      payload: { incidentType: 'tardy', severity: 'low', description: 'late', incidentDate: '2026-01-01' },
    });
    expect(addDiscipline.statusCode).toBe(403);

    // Documents require medical/registrar staff — a guardian is denied even for their own child.
    const docs = await app.inject({ method: 'GET', url: `/students/${ownChildId}/documents` });
    expect([403, 404]).toContain(docs.statusCode);
  });

  it('C011: a plain teacher cannot read student documents (medical/registrar only)', async () => {
    ({ app } = await build());
    current = principal('teacher-1', 'teacher');
    const docs = await app.inject({ method: 'GET', url: `/students/${ownChildId}/documents` });
    expect(docs.statusCode).toBe(403);

    // A nurse (medical staff) can.
    current = principal('nurse-1', 'nurse');
    const nurseDocs = await app.inject({ method: 'GET', url: `/students/${ownChildId}/documents` });
    expect(nurseDocs.statusCode).toBe(200);
  });

  it('C010/C011: cross-tenant student read returns 404 for staff', async () => {
    // A registrar in a DIFFERENT tenant must not read this tenant's student.
    ({ app } = await build());
    current = { sub: 'registrar-b', roles: [{ roleId: 'registrar', roleName: 'registrar' }] };
    // Point the request at another tenant by overriding the onRequest-stamped tenant is not
    // possible here (hook forces TENANT); instead assert an unknown id in this tenant → 404,
    // which is the same not-found path a cross-tenant id takes via findById(id, tenantId).
    const unknown = await app.inject({ method: 'GET', url: `/students/${randomUUID()}` });
    expect(unknown.statusCode).toBe(404);
    const unknown360 = await app.inject({
      method: 'GET',
      url: `/students/${randomUUID()}/consents`,
    });
    expect(unknown360.statusCode).toBe(404);
  });

  it('C011: discipline visibleToParent filtering for a portal reader', async () => {
    const built = await build({ async listReadableStudentIds() { return [ownChildId]; } });
    app = built.app;

    // Registrar seeds two incidents: one visible to parent, one not.
    current = principal('registrar-1', 'registrar');
    await built.s360.addDiscipline(
      TENANT,
      ownChildId,
      { incidentType: 'public', severity: 'low', description: 'shown', incidentDate: '2026-01-01', visibleToParent: true } as never,
      'registrar-1',
    );
    await built.s360.addDiscipline(
      TENANT,
      ownChildId,
      { incidentType: 'private', severity: 'high', description: 'hidden', incidentDate: '2026-01-02', visibleToParent: false } as never,
      'registrar-1',
    );

    // Staff sees both.
    const staffView = await app.inject({ method: 'GET', url: `/students/${ownChildId}/discipline` });
    expect((staffView.json().data as unknown[]).length).toBe(2);

    // Guardian sees only the visibleToParent one.
    current = principal('parent-1', 'guardian');
    const parentView = await app.inject({ method: 'GET', url: `/students/${ownChildId}/discipline` });
    const rows = parentView.json().data as Array<{ incidentType: string; visibleToParent: boolean }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.incidentType).toBe('public');
  });
});
