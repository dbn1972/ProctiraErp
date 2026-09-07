/**
 * Unit smoke for Pg transport repository against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

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
});
