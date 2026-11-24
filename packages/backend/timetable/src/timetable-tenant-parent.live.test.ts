/**
 * PR B1 (FKB-091..094, FKB-096) — live proof that timetable writes resolve their
 * parent ids inside the caller's tenant.
 *
 * Runs as the runtime role (DATABASE_URL = proctira_app, NOSUPERUSER NOBYPASSRLS)
 * through the timetable plugin and PgTimetableRepository.
 *
 * Before the fix (RED, origin/main): tenant A's POST /timetable/meetings with
 * tenant B's bell period, room, section or subject, PUT /timetable/meetings/:id
 * with B's bell period or room, and POST/PUT /timetable/sections with B's room as
 * defaultRoomId answer 201/200 (the id-only FK accepts another tenant's row); a
 * random id answers 409 "Referenced record does not exist or is in use".
 * After (GREEN): 404 NOT_FOUND with identical bodies for another tenant's id and
 * a random id; same-tenant writes keep 201/200.
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestStaff, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgTimetableRepository } from './pg-timetable-repository.js';
import { timetablePlugin } from './timetable-plugin.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'timetable-tenant-parent.live.test' });

type Tree = {
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  subjectId: string;
  bellScheduleId: string;
};
type Res = { statusCode: number; body: string; json: () => Record<string, unknown> };

/** Same body once the probed id is replaced (no existence oracle). */
function normalized(res: Res, id: string): string {
  return res.body.replaceAll(id, '<id>');
}

describe.skipIf(!DATABASE_URL)('PR B1 timetable tenant-parent integrity (live Postgres)', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let treeA: Tree;
  let treeB: Tree;
  let day = 0;
  let periodOrder = 0;

  async function call(
    tenantId: string,
    method: 'POST' | 'PUT',
    url: string,
    payload: Record<string, unknown>,
    ifMatch?: string,
  ): Promise<Res> {
    const res = await app.inject({
      method,
      url,
      payload,
      headers: { 'x-test-tenant': tenantId, ...(ifMatch ? { 'if-match': ifMatch } : {}) },
    });
    return { statusCode: res.statusCode, body: res.body, json: () => res.json() };
  }

  async function seedTree(label: string): Promise<Tree> {
    const tenantId = randomUUID();
    const areaId = randomUUID();
    const institutionId = randomUUID();
    const academicPeriodId = randomUUID();
    const subjectId = randomUUID();
    const bellScheduleId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    await ensurePgTestTenant(pool, tenantId);
    await withPgTenant(pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
         VALUES ($1, $2, 'Root', $3, 0, NULL, '/', 1, 2)`,
        [areaId, tenantId, `R-${suffix}`],
      );
      await client.query(
        `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership)
         VALUES ($1, $2, $3, $4, $5, 'SCHOOL', 'PUBLIC', 'GOVERNMENT')`,
        [institutionId, tenantId, `${label} School`, `${label}-${suffix}`, areaId],
      );
      await client.query(
        `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date)
         VALUES ($1, $2, 'AY 2030-31', $3, '2030-04-01', '2031-03-31')`,
        [academicPeriodId, tenantId, `AY-${suffix}`],
      );
      await client.query(
        `INSERT INTO subjects (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)`,
        [subjectId, tenantId, `${label} subject`, `S-${suffix}`],
      );
      await client.query(
        `INSERT INTO bell_schedules (id, tenant_id, institution_id, academic_period_id, code, name)
         VALUES ($1, $2, $3, $4, $5, 'Bells')`,
        [bellScheduleId, tenantId, institutionId, academicPeriodId, `BS-${suffix}`],
      );
    });
    return { tenantId, institutionId, academicPeriodId, subjectId, bellScheduleId };
  }

  async function newRoom(tree: Tree): Promise<string> {
    const id = randomUUID();
    await withPgTenant(pool, tree.tenantId, (client) =>
      client.query(
        `INSERT INTO rooms (id, tenant_id, institution_id, code, name) VALUES ($1, $2, $3, $4, 'Room')`,
        [id, tree.tenantId, tree.institutionId, `R-${id.slice(0, 8)}`],
      ),
    );
    return id;
  }

  async function newBellPeriod(tree: Tree): Promise<string> {
    const id = randomUUID();
    periodOrder += 1;
    const order = periodOrder;
    await withPgTenant(pool, tree.tenantId, (client) =>
      client.query(
        `INSERT INTO bell_periods (id, tenant_id, bell_schedule_id, code, name, period_order, start_time, end_time)
         VALUES ($1, $2, $3, $4, 'P', $5, '09:00', '09:45')`,
        [id, tree.tenantId, tree.bellScheduleId, `P-${id.slice(0, 8)}`, order],
      ),
    );
    return id;
  }

  async function newSection(tree: Tree): Promise<string> {
    const id = randomUUID();
    await withPgTenant(pool, tree.tenantId, (client) =>
      client.query(
        `INSERT INTO sections (id, tenant_id, institution_id, academic_period_id, code, name)
         VALUES ($1, $2, $3, $4, $5, 'Section')`,
        [id, tree.tenantId, tree.institutionId, tree.academicPeriodId, `SEC-${id.slice(0, 8)}`],
      ),
    );
    return id;
  }

  async function newStaff(tree: Tree): Promise<string> {
    const id = randomUUID();
    await ensurePgTestStaff(pool, tree.tenantId, id);
    return id;
  }

  /** A clash-free tenant-A meeting body: fresh section, staff and bell period. */
  async function meetingBody(): Promise<Record<string, unknown>> {
    day = (day % 7) + 1;
    return {
      institutionId: treeA.institutionId,
      academicPeriodId: treeA.academicPeriodId,
      sectionId: await newSection(treeA),
      staffId: await newStaff(treeA),
      periodId: await newBellPeriod(treeA),
      dayOfWeek: day,
    };
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    treeA = await seedTree('B1A');
    treeB = await seedTree('B1B');
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
      r.tenantId = String(request.headers['x-test-tenant'] ?? '');
      r.user = { sub: 'b1-timetable-live', roles: ['admin'] };
    });
    await app.register(timetablePlugin, {
      repository: new PgTimetableRepository(pool),
      prefix: '/timetable',
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function expectSame404(
    label: string,
    foreignId: string,
    send: (id: string) => Promise<Res>,
  ): Promise<void> {
    const foreign = await send(foreignId);
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: `${label} with id '${foreignId}' not found`,
    });
    const randomId = randomUUID();
    const random = await send(randomId);
    expect(random.statusCode, random.body).toBe(404);
    expect(normalized(foreign, foreignId)).toBe(normalized(random, randomId));
  }

  describe('POST /timetable/meetings', () => {
    const cases: {
      finding: string;
      field: 'periodId' | 'roomId' | 'sectionId' | 'subjectId';
      label: string;
      own: () => Promise<string>;
      foreign: () => Promise<string>;
    }[] = [
      {
        finding: 'FKB-091',
        field: 'periodId',
        label: 'Bell period',
        own: () => newBellPeriod(treeA),
        foreign: () => newBellPeriod(treeB),
      },
      {
        finding: 'FKB-092',
        field: 'roomId',
        label: 'Room',
        own: () => newRoom(treeA),
        foreign: () => newRoom(treeB),
      },
      {
        finding: 'FKB-093',
        field: 'sectionId',
        label: 'Section',
        own: () => newSection(treeA),
        foreign: () => newSection(treeB),
      },
      {
        finding: 'FKB-094',
        field: 'subjectId',
        label: 'Subject',
        own: async () => treeA.subjectId,
        foreign: async () => treeB.subjectId,
      },
    ];
    for (const c of cases) {
      it(`${c.finding} ${c.field}: own 201; other tenant's and random 404, identical`, async () => {
        const own = await call(treeA.tenantId, 'POST', '/timetable/meetings', {
          ...(await meetingBody()),
          [c.field]: await c.own(),
        });
        expect(own.statusCode, own.body).toBe(201);

        await expectSame404(c.label, await c.foreign(), async (id) =>
          call(treeA.tenantId, 'POST', '/timetable/meetings', {
            ...(await meetingBody()),
            [c.field]: id,
          }),
        );
      });
    }
  });

  describe('PUT /timetable/meetings/:id', () => {
    const cases: {
      finding: string;
      field: 'periodId' | 'roomId' | 'sectionId';
      label: string;
      own: () => Promise<string>;
      foreign: () => Promise<string>;
    }[] = [
      {
        finding: 'FKB-091',
        field: 'periodId',
        label: 'Bell period',
        own: () => newBellPeriod(treeA),
        foreign: () => newBellPeriod(treeB),
      },
      {
        finding: 'FKB-092',
        field: 'roomId',
        label: 'Room',
        own: () => newRoom(treeA),
        foreign: () => newRoom(treeB),
      },
      {
        finding: 'FKB-093',
        field: 'sectionId',
        label: 'Section',
        own: () => newSection(treeA),
        foreign: () => newSection(treeB),
      },
    ];
    async function freshMeeting(): Promise<{ id: string; updatedAt: string }> {
      const res = await call(treeA.tenantId, 'POST', '/timetable/meetings', await meetingBody());
      expect(res.statusCode, `meeting fixture: ${res.body}`).toBe(201);
      const json = res.json();
      return { id: String(json['id']), updatedAt: String(json['updatedAt']) };
    }
    for (const c of cases) {
      it(`${c.finding} ${c.field}: own 200; other tenant's and random 404, identical`, async () => {
        const m = await freshMeeting();
        const own = await call(
          treeA.tenantId,
          'PUT',
          `/timetable/meetings/${m.id}`,
          { [c.field]: await c.own() },
          m.updatedAt,
        );
        expect(own.statusCode, own.body).toBe(200);

        const foreignId = await c.foreign();
        await expectSame404(c.label, foreignId, async (id) => {
          const target = await freshMeeting();
          return call(
            treeA.tenantId,
            'PUT',
            `/timetable/meetings/${target.id}`,
            { [c.field]: id },
            target.updatedAt,
          );
        });
      });
    }
  });

  describe('FKB-096 sections.default_room_id', () => {
    function sectionBody(defaultRoomId: string): Record<string, unknown> {
      const suffix = randomUUID().slice(0, 8);
      return {
        institutionId: treeA.institutionId,
        academicPeriodId: treeA.academicPeriodId,
        name: `B1 section ${suffix}`,
        code: `B1-${suffix}`,
        defaultRoomId,
      };
    }

    it("POST /timetable/sections: own room 201; other tenant's and random 404, identical", async () => {
      const own = await call(
        treeA.tenantId,
        'POST',
        '/timetable/sections',
        sectionBody(await newRoom(treeA)),
      );
      expect(own.statusCode, own.body).toBe(201);
      await expectSame404('Room', await newRoom(treeB), (id) =>
        call(treeA.tenantId, 'POST', '/timetable/sections', sectionBody(id)),
      );
    });

    it("PUT /timetable/sections/:id: own room 200; other tenant's and random 404, identical", async () => {
      async function freshSection(): Promise<{ id: string; updatedAt: string }> {
        const res = await call(treeA.tenantId, 'POST', '/timetable/sections', {
          ...sectionBody(await newRoom(treeA)),
        });
        expect(res.statusCode, `section fixture: ${res.body}`).toBe(201);
        const json = res.json();
        return { id: String(json['id']), updatedAt: String(json['updatedAt']) };
      }
      const put = (s: { id: string; updatedAt: string }, defaultRoomId: string) =>
        call(
          treeA.tenantId,
          'PUT',
          `/timetable/sections/${s.id}?institutionId=${treeA.institutionId}`,
          { defaultRoomId },
          s.updatedAt,
        );
      const own = await put(await freshSection(), await newRoom(treeA));
      expect(own.statusCode, own.body).toBe(200);
      await expectSame404('Room', await newRoom(treeB), async (id) =>
        put(await freshSection(), id),
      );
    });
  });
});
