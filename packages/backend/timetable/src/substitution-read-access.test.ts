/**
 * S-D2: GET /timetable/substitutions is the substitution desk's list. Each row names the absent
 * and covering teacher, the date and the free-text reason (e.g. "medical leave"), so only the
 * roles that run the desk (`substitution.read` = the scheduler roles that may create
 * substitutions) read it. Portal roles, teachers and other staff get 403.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { timetablePlugin } from './timetable-plugin.js';
import { TimetableService } from './timetable-service.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '99999999-9999-4999-8999-999999999999';
const INST = '22222222-2222-4222-8222-222222222222';
const TERM = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';
const ABSENT = '55555555-5555-4555-8555-555555555555';
const COVER = '66666666-6666-4666-8666-666666666666';
const REASON = 'medical leave S-D2';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(): Promise<FastifyInstance> {
  const repository = new InMemoryTimetableRepository();
  repository.seedSection({
    id: SECTION,
    tenantId: TENANT_A,
    institutionId: INST,
    academicPeriodId: TERM,
  });
  const service = new TimetableService(repository);
  const schedule = await service.createBellSchedule(TENANT_A, {
    institutionId: INST,
    academicPeriodId: TERM,
    name: 'Morning',
    code: 'AM',
    dayPattern: '1,2,3,4,5',
    status: 'active',
  });
  const period = await service.createPeriod(TENANT_A, {
    bellScheduleId: schedule.id,
    name: 'P1',
    periodOrder: 1,
    startTime: '08:00',
    endTime: '08:45',
  });
  const meeting = await service.createMeeting(TENANT_A, {
    institutionId: INST,
    academicPeriodId: TERM,
    sectionId: SECTION,
    subjectId: null,
    staffId: ABSENT,
    periodId: period.id,
    roomId: null,
    dayOfWeek: 1,
    status: 'active',
  });
  await service.createSubstitution(TENANT_A, {
    sectionMeetingId: meeting.id,
    substituteStaffId: COVER,
    substitutionDate: '2026-09-07',
    reason: REASON,
  });
  const instance = Fastify({ logger: false });
  instance.addHook('onRequest', async (request) => {
    const tenantId = String(request.headers['x-test-tenant'] ?? TENANT_A);
    const role = String(request.headers['x-test-role'] ?? 'admin');
    (request as FastifyRequest & { tenantId?: string }).tenantId = tenantId;
    (
      request as FastifyRequest & { user: { sub: string; tenantId: string; roles: unknown[] } }
    ).user = {
      sub: `user-${role}`,
      tenantId,
      roles: [{ roleId: role, roleName: role }],
    };
  });
  await instance.register(timetablePlugin, { repository, service, prefix: '/timetable' });
  app = instance;
  return instance;
}

async function list(role: string, tenantId = TENANT_A, query = '') {
  return app!.inject({
    method: 'GET',
    url: `/timetable/substitutions${query}`,
    headers: { 'x-test-role': role, 'x-test-tenant': tenantId },
  });
}

describe('GET /timetable/substitutions authorization (S-D2)', () => {
  it.each(['student', 'parent', 'guardian'])(
    'portal role %s gets 403 and no reason',
    async (role) => {
      await build();
      const res = await list(role);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(REASON);
      expect(res.body).not.toContain(ABSENT);
    },
  );

  it.each(['teacher', 'staff', 'hod', 'academic_coordinator', 'staff_admin'])(
    'non-scheduler staff role %s gets 403 and no reason',
    async (role) => {
      await build();
      const res = await list(role);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(REASON);
    },
  );

  it.each(['admin', 'principal', 'registrar', 'timetable_officer', 'school_admin'])(
    'desk role %s still reads the substitution with its reason',
    async (role) => {
      await build();
      const res = await list(role);
      expect(res.statusCode).toBe(200);
      const rows = res.json().data as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        originalStaffId: ABSENT,
        substituteStaffId: COVER,
        reason: REASON,
      });
    },
  );

  it('an admin of another tenant sees none of tenant A substitutions', async () => {
    await build();
    for (const query of ['', `?institutionId=${INST}`]) {
      const res = await list('admin', TENANT_B, query);
      expect(res.statusCode, query).toBe(200);
      expect(res.json().data, query).toEqual([]);
      expect(res.body, query).not.toContain(REASON);
    }
  });
});
