/**
 * Notification API client.
 *
 * Browser helpers for notification preferences (settings UI) and
 * server helpers for the in-app notifications inbox.
 */

import {
  browserGatewayFetch,
  BrowserGatewayError,
} from './browser-gateway';
import { gatewayFetch, getSessionContext } from './gateway';
import { decodeTokenPayload } from '@/lib/auth';

// ─── Preference types ────────────────────────────────────────────────────

/** Delivery channels supported by the Notification Service. */
export type NotificationChannel = 'email' | 'in_app' | 'push' | 'webhook';

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
  categories: CategoryPreference[];
  digestFrequency: DigestFrequency;
  quietHours: QuietHours;
}

/** Patch payload — all fields optional for partial updates. */
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

// ─── Inbox (App Router server components) ────────────────────────────────

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

function unwrapNotificationList<T>(payload: { data?: T[] } | T[] | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

function resolveNotificationUserId(): string | null {
  const { accessToken } = getSessionContext();
  if (!accessToken) return null;
  const payload = decodeTokenPayload(accessToken);
  const sub = payload?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

/** Lists the current user's notifications; empty when no session user. */
export async function listMyNotifications(): Promise<NotificationItem[]> {
  const userId = resolveNotificationUserId();
  if (!userId) return [];

  const result = await gatewayFetch<{ data: NotificationItem[] } | NotificationItem[]>(
    `/notifications/user/${userId}?pageSize=50`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrapNotificationList(result.data);
}
