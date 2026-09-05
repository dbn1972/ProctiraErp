import 'server-only';
import { decodeTokenPayload } from '@/lib/auth';
import { gatewayFetch, getSessionContext } from './gateway';
import type { NotificationItem, NotificationRule, NotificationTemplate } from './notifications';

function unwrap<T>(payload: { data?: T[] } | T[] | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

function userId(): string | null {
  const { accessToken } = getSessionContext();
  if (!accessToken) return null;
  const sub = decodeTokenPayload(accessToken)?.sub;
  return typeof sub === 'string' && sub ? sub : null;
}

export async function listMyNotifications(): Promise<NotificationItem[]> {
  const id = userId();
  if (!id) return [];
  const result = await gatewayFetch<{ data: NotificationItem[] } | NotificationItem[]>(
    `/notifications/user/${id}?pageSize=50`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrap(result.data);
}

export async function listNotificationRules(): Promise<NotificationRule[]> {
  const result = await gatewayFetch<{ data: NotificationRule[] } | NotificationRule[]>(
    '/notifications/rules',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrap(result.data);
}

export async function listNotificationTemplates(): Promise<NotificationTemplate[]> {
  const result = await gatewayFetch<{ data: NotificationTemplate[] } | NotificationTemplate[]>(
    '/notifications/templates',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrap(result.data);
}
