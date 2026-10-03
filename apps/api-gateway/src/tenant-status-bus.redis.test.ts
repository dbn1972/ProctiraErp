/**
 * PRC-H008: live Redis pub/sub — a lifecycle transition published by one gateway replica is
 * enforced by another replica without waiting for the status-cache TTL. Runs when REDIS_URL is set.
 */
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  clearSuspendedTenantsForTests,
  configureTenantStatusSource,
  noteTenantStatusChange,
  resolveTenantBlocked,
  startRedisTenantStatusBus,
  type TenantStatusBus,
} from './tenant-entitlement.js';

const REDIS_URL = process.env['REDIS_URL'];
const describeRedis = REDIS_URL ? describe : describe.skip;

describeRedis('PRC-H008 tenant-status bus over live Redis', () => {
  let redisA: Redis;
  let redisB: Redis;
  let busA: TenantStatusBus;
  let busB: TenantStatusBus;

  beforeAll(async () => {
    redisA = new Redis(REDIS_URL!);
    redisB = new Redis(REDIS_URL!);
    busA = await startRedisTenantStatusBus(redisA);
    busB = await startRedisTenantStatusBus(redisB);
  });

  afterAll(async () => {
    await busA.close();
    await busB.close();
    await redisA.quit();
    await redisB.quit();
  });

  afterEach(() => clearSuspendedTenantsForTests());

  async function eventually(check: () => Promise<boolean>): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('condition not met within 1s');
  }

  it('a suspension published by replica A invalidates the stale cache; reactivation likewise', async () => {
    const tenantId = '0f0e0d0c-0b0a-4908-8706-050403020100';
    let stored: 'active' | 'suspended' = 'active';
    configureTenantStatusSource(() => Promise.resolve(stored), { ttlMs: 60_000 });
    try {
      noteTenantStatusChange(tenantId, 'active'); // warm cache
      stored = 'suspended';
      expect(await resolveTenantBlocked(tenantId)).toBe(false);
      await busA.publish(tenantId, 'suspended');
      await eventually(() => resolveTenantBlocked(tenantId));
      stored = 'active';
      await busB.publish(tenantId, 'active');
      await eventually(async () => !(await resolveTenantBlocked(tenantId)));
    } finally {
      configureTenantStatusSource(null);
    }
  });
});
