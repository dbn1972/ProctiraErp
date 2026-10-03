/**
 * Unit smoke for Pg transport repository against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';

import { isPgTransportEnabled } from './create-transport-repository.js';
import { getSharedTransportPool, PgTransportRepository } from './pg-transport-repository.js';

describe('PgTransportRepository', () => {
  it.skipIf(!isPgTransportEnabled())('creates, lists, and deletes a route', async () => {
    const pool = getSharedTransportPool();
    expect(pool).not.toBeNull();
    const repo = new PgTransportRepository(pool!);
    const tenantId = randomUUID();
    const routeId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);

    await repo.createRoute({
      id: routeId,
      tenantId,
      name: 'Pg unit test route',
      description: null,
      status: 'active',
      startLocation: 'Campus A',
      endLocation: 'Campus B',
      distanceKm: 12.5,
      estimatedDurationMinutes: 45,
      operatingDays: ['Mon', 'Wed', 'Fri'],
      departureTime: '07:30',
      returnTime: '15:30',
      institutionId: null,
    });

    const listed = await repo.listRoutes(tenantId, {}, { page: 1, pageSize: 20 });
    expect(listed.data.some((route) => route.id === routeId)).toBe(true);

    const deleted = await repo.deleteRoute(routeId, tenantId);
    expect(deleted).toBe(true);
  });

  // PRC-M448: two concurrent edits on different fields both survive (partial UPDATE).
  it('partial update only writes provided columns', async () => {
    const statements: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        statements.push({ text, values });
        return { rows: /^UPDATE transport_vehicles/.test(text) ? [{}] : [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client, query: client.query } as never;
    const repo = new PgTransportRepository(pool);
    (repo as unknown as { ensureSchema: () => Promise<void> }).ensureSchema = async () => undefined;
    const tenantId = randomUUID();
    await Promise.all([
      repo.updateVehicle('v1', tenantId, { status: 'maintenance' }),
      repo.updateVehicle('v1', tenantId, { capacity: 52 }),
    ]);
    const updates = statements.filter((st) => st.text.startsWith('UPDATE transport_vehicles'));
    expect(updates).toHaveLength(2);
    expect(updates[0]!.text).toContain('status = $3');
    expect(updates[0]!.text).not.toContain('capacity');
    expect(updates[1]!.text).toContain('capacity = $3');
    expect(updates[1]!.text).not.toContain('status');
  });

  it.skipIf(!isPgTransportEnabled())(
    'concurrent updates on different fields preserve both',
    async () => {
      const pool = getSharedTransportPool()!;
      const repo = new PgTransportRepository(pool);
      const tenantId = randomUUID();
      const routeId = randomUUID();
      await ensurePgTestTenant(pool, tenantId);
      await repo.createRoute({
        id: routeId,
        tenantId,
        name: 'M448 route',
        description: null,
        status: 'active',
        startLocation: 'A',
        endLocation: 'B',
        distanceKm: 5,
        estimatedDurationMinutes: 20,
        operatingDays: ['Mon'],
        departureTime: '07:30',
        returnTime: '15:30',
        institutionId: null,
      });
      await Promise.all([
        repo.updateRoute(routeId, tenantId, { status: 'inactive' }),
        repo.updateRoute(routeId, tenantId, { name: 'M448 renamed' }),
      ]);
      const after = await repo.findRouteById(routeId, tenantId);
      expect(after?.status).toBe('inactive');
      expect(after?.name).toBe('M448 renamed');
      await repo.deleteRoute(routeId, tenantId);
    },
  );
});
