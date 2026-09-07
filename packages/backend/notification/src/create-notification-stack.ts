/**
 * Factory for notification repository + prefs store (gateway wiring).
 */
import { InMemoryNotificationRepository } from './in-memory-repository.js';
import type { NotificationRepository } from './notification-repository.js';
import { createNotificationPrefsStore, type NotificationPrefsStore } from './prefs-store.js';

export interface NotificationStack {
  repository: NotificationRepository;
  prefsStore: NotificationPrefsStore;
}

export function createNotificationStack(): NotificationStack {
  return {
    repository: new InMemoryNotificationRepository(),
    prefsStore: createNotificationPrefsStore(),
  };
}
