/**
 * Notification API — browser-safe preference helpers + shared types.
 *
 * Server-only inbox/admin helpers live in `./notifications.server` so Client
 * Components never pull `next/headers` via gateway.ts.
 */

import {
  browserGatewayFetch,
  BrowserGatewayError,
} from './browser-gateway';

// ─── Preference types ────────────────────────────────────────────────────

export type NotificationChannel = 'email' | 'in_app' | 'push' | 'webhook';

export type NotificationCategory =
  | 'academic'
  | 'attendance'
  | 'examination'
  | 'workflow'
  | 'system';

export type DigestFrequency = 'immediate' | 'daily' | 'weekly';

export interface CategoryPreference {
  category: NotificationCategory;
  channels: Record<NotificationChannel, boolean>;
}

export interface QuietHours {
  enabled: boolean;
  startTime: string;
  endTime: string;
  days: number[];
}

export interface NotificationPreferencesData {
  categories: CategoryPreference[];
  digestFrequency: DigestFrequency;
  quietHours: QuietHours;
}

export type NotificationPreferencesPatch = Partial<NotificationPreferencesData>;

export const NOTIFICATION_API_ENDPOINTS = {
  PREFERENCES: '/notifications/preferences',
} as const;

export async function getNotificationPreferences(): Promise<NotificationPreferencesData> {
  return browserGatewayFetch<NotificationPreferencesData>(
    NOTIFICATION_API_ENDPOINTS.PREFERENCES,
  );
}

export async function updateNotificationPreferences(
  patch: NotificationPreferencesPatch,
): Promise<NotificationPreferencesData> {
  return browserGatewayFetch<NotificationPreferencesData>(
    NOTIFICATION_API_ENDPOINTS.PREFERENCES,
    {
      method: 'PATCH',
      json: patch,
    },
  );
}

export { BrowserGatewayError as NotificationApiError };

// ─── Shared inbox / admin types ──────────────────────────────────────────

export type DeliveryChannel = 'email' | 'in_app' | 'push' | 'webhook';
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface NotificationItem {
  id: string;
  channel: DeliveryChannel;
  templateId: string;
  recipientUserId: string;
  variables: Record<string, string>;
  status: DeliveryStatus;
  priority: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface NotificationRule {
  id: string;
  tenantId?: string;
  name: string;
  entityType: string;
  event: string;
  conditions: Record<string, unknown>;
  templateId: string;
  channels: string[];
  recipientQuery: Record<string, unknown>;
  isActive: boolean;
  schedule: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplate {
  id: string;
  tenantId?: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Alias — settings UI historical name */
