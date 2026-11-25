/**
 * PRC-M121 — discipline records are not part of the general student profile.
 *
 * Before the fix any staff role that could read a student (staff, nurse) got that student's
 * parent-visible discipline incidents, and a teacher got every incident of every student in the
 * tenant. Now: staff need a discipline role; a teacher without an admin / registrar role only
 * reaches students they teach; a missing or failing teacher-scope lookup denies (fail closed).
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStudentRepository } from '../in-memory-repository.js';
import { StudentService } from '../student-service.js';
import type { TeacherStudentScope } from '../student-portal-access.js';
import { InMemoryStudentBlobStore } from './blob-store.js';
import { registerStudents360Routes } from './routes.js';
import { Students360Service } from './service.js';
import { InMemoryStudents360Store } from './store.js';

const TENANT = randomUUID();

interface Principal {
  sub: string;
  roles: Array<{ roleId: string; roleName: string }>;
}

function principal(sub: string, ...roleIds: string[]): Principal {
  return { sub, roles: roleIds.map((r) => ({ roleId: r, roleName: r })) };
}

describe('PRC-M121 discipline permission and teacher section scope', () => {
  let app: FastifyInstance | null = null;
  let current: Principal;
  let s360: Students360Service;
  let taughtId: string;
  let otherId: string;

  async function build(teacherStudentScope?: TeacherStudentScope) {
    const repo = new InMemoryStudentRepository();
    const svc = new StudentService(repo);
    taughtId = (
      await svc.create(TENANT, {
        firstName: 'Taught',
        lastName: 'Student',
        dateOfBirth: '2011-01-01',
        gender: 'female',
      })
    ).id;
    otherId = (
      await svc.create(TENANT, {
        firstName: 'Other',
        lastName: 'Student',
        dateOfBirth: '2011-02-02',
        gender: 'male',
      })
    ).id;
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
    for (const studentId of [taughtId, otherId]) {
      await s360.addDiscipline(
        TENANT,
        studentId,
        {
          incidentType: 'late',
          severity: 'low',
          description: 'Late to class',
          incidentDate: '2026-01-10',
          visibleToParent: true,
        },
        'registrar-1',
      );
    }
    const a = Fastify({ logger: false });
    a.decorateRequest('tenantId', '');
    a.decorateRequest('user', null);
    a.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: Principal }).user = current;
    });
    await registerStudents360Routes(a, {
      service: s360,
      prefix: '/students',
      teacherStudentScope,
    });
    await a.ready();
    app = a;
    return a;
  }

  const teachesOnlyTaught: TeacherStudentScope = {
    async teachesStudent(_tenantId, principalIds, studentId) {
      return principalIds.includes('teacher-1') && studentId === taughtId;
    },
  };

  beforeEach(() => {
    current = principal('registrar-1', 'registrar');
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('staff without a discipline role (staff, nurse) cannot read discipline', async () => {
    const a = await build(teachesOnlyTaught);
    for (const role of ['staff', 'nurse']) {
      current = principal(`${role}-1`, role);
      const res = await a.inject({ method: 'GET', url: `/students/${taughtId}/discipline` });
      expect(res.statusCode, role).toBe(403);
    }
  });

  it('a teacher reads and writes discipline only for students they teach', async () => {
    const a = await build(teachesOnlyTaught);
    current = principal('teacher-1', 'teacher');
    const taught = await a.inject({ method: 'GET', url: `/students/${taughtId}/discipline` });
    expect(taught.statusCode).toBe(200);
    expect((taught.json() as { data: unknown[] }).data).toHaveLength(1);

    const other = await a.inject({ method: 'GET', url: `/students/${otherId}/discipline` });
    expect(other.statusCode).toBe(403);
    const write = await a.inject({
      method: 'POST',
      url: `/students/${otherId}/discipline`,
      payload: {
        incidentType: 'late',
        severity: 'low',
        description: 'x',
        incidentDate: '2026-01-11',
      },
    });
    expect(write.statusCode).toBe(403);
  });

  it('a teacher is denied when the scope lookup is missing or fails', async () => {
    current = principal('teacher-1', 'teacher');
    const unwired = await build(undefined);
    const res = await unwired.inject({ method: 'GET', url: `/students/${taughtId}/discipline` });
    expect(res.statusCode).toBe(403);
    await unwired.close();

    const failing = await build({
      async teachesStudent() {
        throw new Error('simulated lookup failure');
      },
    });
    const res2 = await failing.inject({ method: 'GET', url: `/students/${taughtId}/discipline` });
    expect(res2.statusCode).toBe(403);
  });

  it('registrar / admin keep tenant-wide discipline access without a lookup', async () => {
    const a = await build(undefined);
    for (const role of ['registrar', 'principal']) {
      current = principal(`${role}-1`, role);
      const res = await a.inject({ method: 'GET', url: `/students/${otherId}/discipline` });
      expect(res.statusCode, role).toBe(200);
    }
  });
});
