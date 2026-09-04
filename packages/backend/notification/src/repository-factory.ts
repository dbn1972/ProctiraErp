/**
 * Notification repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaNotificationRepository} (Postgres + RLS)
 *   - otherwise          → {@link InMemoryNotificationRepository} (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import type { NotificationRepository } from './notification-repository.js';
import { PrismaNotificationRepository } from './prisma-notification-repository.js';

export interface NotificationRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
}

export function createNotificationRepository(
  config: NotificationRepositoryConfig = {},
): NotificationRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryNotificationRepository();
  }
  return new PrismaNotificationRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
