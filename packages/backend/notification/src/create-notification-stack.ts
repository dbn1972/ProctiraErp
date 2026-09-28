/**
 * Factory for notification repository + prefs store (gateway wiring).
 * When DATABASE_URL is set, deliveries persist via HybridNotificationRepository (G-207).
 * Provider adapters remain sandbox / WAIVED.
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import { CacheClient } from '@proctira/cache';
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import type { NotificationRepository } from './notification-repository.js';
import {
  createPgNotificationRepository,
  isPgNotificationEnabled,
} from './pg-notification-repository.js';
import { createNotificationPrefsStore, type NotificationPrefsStore } from './prefs-store.js';

export interface NotificationStack {
  repository: NotificationRepository;
  prefsStore: NotificationPrefsStore;
  /** Persistence mode for deliveries */
  persistence: 'postgres' | 'memory';
  /**
   * Optional Redis read-through cache for `NotificationService.countUnreadNotifications`,
   * constructed from `REDIS_URL` when present. `undefined` when unset — callers must
   * treat this as opt-in, mirroring `loadDashboardAggregates`'s `cache` parameter
   * (`packages/backend/report/src/dashboards.ts`).
   */
  cache?: CacheClient;
}

export function createNotificationStack(): NotificationStack {
  const redisUrl = process.env['REDIS_URL'];
  const cache = redisUrl ? new CacheClient({ redisUrl }) : undefined;

  if (isPgNotificationEnabled()) {
    const pg = createPgNotificationRepository();
    assertPostgresRepositoryAvailable('notification', pg);
    return {
      repository: pg,
      prefsStore: createNotificationPrefsStore(),
      persistence: 'postgres',
      cache,
    };
  }
  assertInMemoryFallbackAllowed('notification');
  return {
    repository: new InMemoryNotificationRepository(),
    prefsStore: createNotificationPrefsStore(),
    persistence: 'memory',
    cache,
  };
}
