/**
 * Notification preferences API client (Task 60A.11).
 *
 * Provides typed helpers for fetching and updating user notification
 * preferences via the Notification Service backend (task 18).
 *
 * Endpoints:
 *   • GET  /api/v1/notifications/preferences — current user preferences
 *   • PATCH /api/v1/notifications/preferences — partial update
 *
 * Uses `browserGatewayFetch` for authenticated browser-side requests.
 *
 * Validates: Requirements 22.1, 22.2, 22.4, 22.5
 */

import { browserGatewayFetch, BrowserGatewayError } from './browser-gateway';

// ─── Types ───────────────────────────────────────────────────────────────

/** Delivery channels supported by the Notification Service. */
export type NotificationChannel = 'email' | 'in_app' | 'push' | 'webhook' | 'sms';

/** Notification categories that users can opt in/out of. */
export type NotificationCategory =
  | 'academic'
  | 'attendance'
  | 'examination'
  | 'workflow'
  | 'system';

/** Digest frequency options. */
export type DigestFrequency = 'immediate' | 'daily' | 'weekly';

/** Per-category channel preferences. */
export interface CategoryPreference {
  category: NotificationCategory;
  channels: Record<NotificationChannel, boolean>;
}

/** Quiet hours configuration. */
export interface QuietHours {
  enabled: boolean;
  /** Start time in HH:mm format (24h). */
  startTime: string;
  /** End time in HH:mm format (24h). */
  endTime: string;
  /** Days of the week (0 = Sunday, 6 = Saturday). */
  days: number[];
}

/** Full notification preferences payload. */
export interface NotificationPreferencesData {
  /** Per-category channel toggles. */
  categories: CategoryPreference[];
  /** Digest frequency setting. */
  digestFrequency: DigestFrequency;
  /** Quiet hours configuration. */
  quietHours: QuietHours;
}

/** Patch payload — all fields optional for partial updates. */
export type NotificationPreferencesPatch = Partial<NotificationPreferencesData>;

// ─── API Endpoints ───────────────────────────────────────────────────────

export const NOTIFICATION_API_ENDPOINTS = {
  PREFERENCES: '/notifications/preferences',
} as const;

// ─── API Helpers ─────────────────────────────────────────────────────────

/**
 * Fetches the current user's notification preferences.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferencesData> {
  return browserGatewayFetch<NotificationPreferencesData>(NOTIFICATION_API_ENDPOINTS.PREFERENCES);
}

/**
 * Updates the current user's notification preferences (partial update).
 * Returns the merged preferences snapshot from the server.
 */
export async function updateNotificationPreferences(
  patch: NotificationPreferencesPatch,
): Promise<NotificationPreferencesData> {
  return browserGatewayFetch<NotificationPreferencesData>(NOTIFICATION_API_ENDPOINTS.PREFERENCES, {
    method: 'PATCH',
    json: patch,
  });
}

export { BrowserGatewayError as NotificationApiError };
