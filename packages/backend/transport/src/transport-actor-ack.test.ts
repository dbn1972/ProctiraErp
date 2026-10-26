/**
 * PRC-L392: actor attribution comes from the principal's `sub` (no literal
 * "transport" fallback) and alert acknowledgement is first-writer-wins.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryTransportRepository } from './in-memory-repository.js';
import { PgTransportRepository } from './pg-transport-repository.js';
import { transportPlugin } from './transport-plugin.js';
import { TransportService } from './transport-service.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

async function buildApp(
  repository: InMemoryTransportRepository,
  user: { sub?: string; roles: string[] },
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    const r = request as { tenantId?: string; user?: { sub?: string; roles: string[] } };
    r.tenantId = TENANT;
    r.user = user;
  });
  await app.register(transportPlugin, { repository });
  await app.ready();
  return app;
}

async function seedRoute(service: TransportService) {
  return service.createRoute(TENANT, {
    name: 'North Loop',
    startLocation: 'Depot',
    endLocation: 'School',
    operatingDays: ['monday'],
    departureTime: '07:30',
  });
}

function attendancePayload(routeId: string) {
  return {
    routeId,
    tripDate: '2026-09-09',
    direction: 'pickup',
    studentId: randomUUID(),
    status: 'boarded',
  };
}

describe('transport actor attribution (PRC-L392)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects a write with 401 when the principal has no sub, and writes nothing', async () => {
    const repo = new InMemoryTransportRepository();
    const route = await seedRoute(new TransportService(repo));
    app = await buildApp(repo, { roles: ['transport_officer'] });
    const payload = attendancePayload(route.id);
    const res = await app.inject({ method: 'POST', url: '/transport/attendance', payload });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    const rows = await repo.listBusAttendanceTrip(TENANT, {
      routeId: route.id,
      tripDate: payload.tripDate,
      direction: 'pickup',
    });
    expect(rows).toHaveLength(0);
  });

  it('records the principal sub as the actor', async () => {
    const repo = new InMemoryTransportRepository();
    const route = await seedRoute(new TransportService(repo));
    app = await buildApp(repo, { sub: 'officer-1', roles: ['transport_officer'] });
    const res = await app.inject({
      method: 'POST',
      url: '/transport/attendance',
      payload: attendancePayload(route.id),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recordedBy).toBe('officer-1');
  });
});

describe('alert acknowledgement is first-writer-wins (PRC-L392)', () => {
  it('a second acknowledgement does not overwrite the first (service + in-memory)', async () => {
    const repo = new InMemoryTransportRepository();
    const service = new TransportService(repo);
    const alert = await repo.createAlert({
      id: randomUUID(),
      tenantId: TENANT,
      ruleId: randomUUID(),
      kind: 'delay_minutes',
      vehicleId: null,
      routeId: null,
      studentId: null,
      message: 'late',
      payload: {},
      acknowledgedAt: null,
      acknowledgedBy: null,
    });
    const first = await service.acknowledgeAlert(TENANT, alert.id, 'officer-1');
    const second = await service.acknowledgeAlert(TENANT, alert.id, 'officer-2');
    expect(first.acknowledgedBy).toBe('officer-1');
    expect(second.acknowledgedBy).toBe('officer-1');
    expect(second.acknowledgedAt?.getTime()).toBe(first.acknowledgedAt?.getTime());
    const stored = (await repo.listAlerts(TENANT)).find((a) => a.id === alert.id);
    expect(stored?.acknowledgedBy).toBe('officer-1');
  });

  function fakePool(updateRows: unknown[], selectRows: unknown[]) {
    const statements: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        statements.push({ text, values });
        if (/^\s*UPDATE transport_alerts/.test(text)) return { rows: updateRows, rowCount: 0 };
        if (/^\s*SELECT \* FROM transport_alerts/.test(text)) {
          return { rows: selectRows, rowCount: selectRows.length };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client, query: client.query } as never;
    const repo = new PgTransportRepository(pool);
    (repo as unknown as { ensureSchema: () => Promise<void> }).ensureSchema = async () => undefined;
    return { repo, statements };
  }

  const ackedRow = {
    id: 'a1',
    tenant_id: TENANT,
    rule_id: 'r1',
    kind: 'delay_minutes',
    vehicle_id: null,
    route_id: null,
    student_id: null,
    message: 'late',
    payload: {},
    acknowledged_at: new Date('2026-09-09T08:00:00.000Z'),
    acknowledged_by: 'officer-1',
    created_at: new Date('2026-09-09T07:55:00.000Z'),
  };

  it('PG: the UPDATE only claims unacknowledged alerts and returns the stored row otherwise', async () => {
    const { repo, statements } = fakePool([], [ackedRow]);
    const result = await repo.acknowledgeAlert('a1', TENANT, 'officer-2');
    const update = statements.find((st) => /UPDATE transport_alerts/.test(st.text));
    expect(update?.text).toContain('acknowledged_at IS NULL');
    const select = statements.find((st) => /SELECT \* FROM transport_alerts/.test(st.text));
    expect(select?.text).toContain('tenant_id = $2');
    expect(select?.values).toEqual(['a1', TENANT]);
    expect(result?.acknowledgedBy).toBe('officer-1');
  });

  it('PG: returns null (404 upstream) when the alert does not exist for the tenant', async () => {
    const { repo } = fakePool([], []);
    expect(await repo.acknowledgeAlert('missing', TENANT, 'officer-2')).toBeNull();
  });
});
