/**
 * PRC-C011 regression: the students-360 authorization gate must also run when the student
 * plugin is mounted under the gateway's `/api/v1` prefix, and for HEAD requests.
 *
 * `student-portal-authz.test.ts` mounts the routes at `/students` with no version prefix, which
 * is why a `request.url.startsWith('/students/')` check passed CI while being skipped in
 * production (gateway URL is `/api/v1/students/...`).
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStudentRepository } from '../in-memory-repository.js';
import { registerStudentRoutes } from '../routes.js';
import { StudentService } from '../student-service.js';
import type { StudentPortalBinding } from '../student-portal-access.js';

import { InMemoryStudentBlobStore } from './blob-store.js';
import { registerStudents360Routes } from './routes.js';
import { Students360Service } from './service.js';
import { InMemoryStudents360Store } from './store.js';

const TENANT = randomUUID();
const API = '/api/v1';

interface Principal {
  sub: string;
  roles: Array<{ roleId: string; roleName: string }>;
}

function principal(sub: string, ...roleIds: string[]): Principal {
  return { sub, roles: roleIds.map((r) => ({ roleId: r, roleName: r })) };
}

describe('PRC-C011 students-360 gate under the gateway /api/v1 prefix', () => {
  let app: FastifyInstance;
  let repo: InMemoryStudentRepository;
  let current: Principal;
  let ownChildId: string;
  let otherChildId: string;

  const binding: StudentPortalBinding = {
    async listReadableStudentIds() {
      return [ownChildId];
    },
  };

  let s360: Students360Service;

  async function build(): Promise<FastifyInstance> {
    const a = Fastify({ logger: false });
    a.decorateRequest('tenantId', '');
    a.decorateRequest('user', null);
    a.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: Principal }).user = current;
    });
    const studentService = new StudentService(repo);
    s360 = new Students360Service({
      students: repo,
      store: new InMemoryStudents360Store(),
      blobs: new InMemoryStudentBlobStore(),
      attendance: {
        async listStudentAttendanceInRange() {
          return [];
        },
      },
    });
    // Same shape as the gateway: every domain is registered inside an `/api/v1` scope.
    await a.register(
      async (scope) => {
        await registerStudentRoutes(scope, { studentService, studentBinding: binding });
        await registerStudents360Routes(scope, {
          service: s360,
          prefix: '/students',
          studentBinding: binding,
        });
      },
      { prefix: API },
    );
    await a.ready();
    return a;
  }

  beforeEach(async () => {
    repo = new InMemoryStudentRepository();
    const svc = new StudentService(repo);
    const own = await svc.create(TENANT, {
      firstName: 'Own',
      lastName: 'Child',
      dateOfBirth: '2010-01-01',
      gender: 'female',
    });
    const other = await svc.create(TENANT, {
      firstName: 'Other',
      lastName: 'Child',
      dateOfBirth: '2010-02-02',
      gender: 'male',
    });
    ownChildId = own.id;
    otherChildId = other.id;
    current = principal('parent-1', 'guardian');
    app = await build();
  });

  afterEach(async () => {
    await app.close();
  });

  it("a guardian gets 404 on another child's 360 reads", async () => {
    for (const sub of [
      'photo',
      'id-card.pdf',
      'siblings',
      'consents',
      'discipline',
      'attendance-heatmap',
      'documents',
      `documents/${randomUUID()}`,
    ]) {
      const url = `${API}/students/${otherChildId}/${sub}`;
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `GET ${url}`).toBe(404);
    }
  });

  it("HEAD and GET on another child's real document are gated", async () => {
    const doc = await s360.uploadDocument(
      TENANT,
      otherChildId,
      {
        category: 'medical',
        fileName: 'clinic-note.pdf',
        mimeType: 'application/pdf',
        contentBase64: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64'),
      },
      'nurse-1',
    );
    const url = `${API}/students/${otherChildId}/documents/${doc.id}`;
    for (const method of ['HEAD', 'GET'] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(String(res.headers['content-disposition'] ?? '')).not.toContain('clinic-note');
    }
  });

  it('a guardian cannot write 360 records for their own child', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/students/${ownChildId}/discipline`,
      payload: {
        incidentType: 'tardy',
        severity: 'low',
        description: 'late',
        incidentDate: '2026-01-01',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('documents stay medical/registrar-only under the prefix', async () => {
    current = principal('teacher-1', 'teacher');
    const teacher = await app.inject({
      method: 'GET',
      url: `${API}/students/${ownChildId}/documents`,
    });
    expect(teacher.statusCode).toBe(403);

    current = principal('nurse-1', 'nurse');
    const nurse = await app.inject({
      method: 'GET',
      url: `${API}/students/${ownChildId}/documents`,
    });
    expect(nurse.statusCode).toBe(200);
  });

  it('a percent-encoded segment does not slip past the gate', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API}/students/${otherChildId}/%64ocuments`,
    });
    expect(res.statusCode).not.toBe(200);
  });

  it("a guardian can still read their own child's consents (gate allows owners)", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API}/students/${ownChildId}/consents`,
    });
    expect(res.statusCode).toBe(200);
  });
});
