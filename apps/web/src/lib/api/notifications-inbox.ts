/**
 * Server-side notifications inbox client.
 */
import { gatewayFetch } from './gateway';

export interface InboxNotification {
  id: string;
  channel: string;
  templateId: string;
  recipientUserId: string;
  variables: Record<string, string>;
  status: string;
  priority: string;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export async function listUserNotifications(userId: string): Promise<InboxNotification[]> {
  const result = await gatewayFetch<{ data: InboxNotification[] }>(
    `/notifications/user/${encodeURIComponent(userId)}?page=1&pageSize=50`,
    {
      throwOnError: false,
      next: { revalidate: 0 },
    },
  );
  return result.data?.data ?? [];
}
