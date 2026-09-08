/**
 * Factory for notification repository + prefs store (gateway wiring).
 * When DATABASE_URL is set, deliveries persist via HybridNotificationRepository (G-207).
 * Provider adapters remain sandbox / WAIVED.
 */
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
}

export function createNotificationStack(): NotificationStack {
  if (isPgNotificationEnabled()) {
    const pg = createPgNotificationRepository();
    if (pg) {
      return {
        repository: pg,
        prefsStore: createNotificationPrefsStore(),
        persistence: 'postgres',
      };
    }
  }
  return {
    repository: new InMemoryNotificationRepository(),
    prefsStore: createNotificationPrefsStore(),
    persistence: 'memory',
  };
}
