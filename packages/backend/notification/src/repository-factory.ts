/**
 * Notification repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaNotificationRepository} (Postgres + RLS)
 *     with role/area/institution expansion via injected
 *     {@link NotificationRecipientLookup} (defaults to Prisma auth-schema ports)
 *   - otherwise          → {@link InMemoryNotificationRepository} (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import {
  createNotificationRecipientLookup,
  type CrossModuleRecipientLookupDeps,
  type NotificationRecipientLookup,
} from './cross-module-recipient-lookup.js';
import { InMemoryNotificationRepository } from './in-memory-repository.js';
import type { NotificationRepository } from './notification-repository.js';
import { PrismaNotificationRepository } from './prisma-notification-repository.js';
import { PrismaRecipientMembershipPorts } from './prisma-recipient-lookup.js';

export interface NotificationRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
  /**
   * Optional recipient expander. When omitted and Prisma is used, a default
   * CrossModule lookup is built from auth `UserRoleAssignment` ports.
   */
  recipientLookup?: NotificationRecipientLookup;
  /**
   * Optional port overrides for the default CrossModule lookup (ignored when
   * `recipientLookup` is provided).
   */
  recipientLookupDeps?: CrossModuleRecipientLookupDeps;
}

export function createNotificationRepository(
  config: NotificationRepositoryConfig = {},
): NotificationRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryNotificationRepository();
  }

  const prisma = createPrismaClient({ datasourceUrl: databaseUrl });

  let recipientLookup = config.recipientLookup;
  if (!recipientLookup) {
    const membership = new PrismaRecipientMembershipPorts(prisma);
    recipientLookup = createNotificationRecipientLookup({
      roles: config.recipientLookupDeps?.roles ?? membership,
      areas: config.recipientLookupDeps?.areas ?? membership,
      institutions: config.recipientLookupDeps?.institutions ?? membership,
    });
  }

  return new PrismaNotificationRepository(prisma, { recipientLookup });
}
