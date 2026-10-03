/**
 * Server-side notifications inbox client.
 */
import { fetchList, type ListResult } from './list-result';

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

/** PRC-M113: a failed inbox read is a ListResult failure, not an empty inbox. */
export async function listUserNotifications(
  userId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<ListResult<InboxNotification>> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 50)));
  return fetchList<InboxNotification>(
    `/notifications/user/${encodeURIComponent(userId)}?page=${page}&pageSize=${pageSize}`,
    { next: { revalidate: 0 } },
  );
}
