/**
 * Server-side notifications inbox client.
 */
import { gatewayFetch } from './gateway';
import { classifyListFailure, type ListResult } from './list-result';

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

/**
 * PRC-M113/M114: a failed inbox read is a ListResult failure, not an empty
 * inbox; the page/unread filter is applied server-side with paging meta.
 */
export async function listUserNotifications(
  userId: string,
  params: { page?: number; pageSize?: number; unreadOnly?: boolean } = {},
): Promise<ListResult<InboxNotification>> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)));
  const unread = params.unreadOnly ? '&unread=true' : '';
  const result = await gatewayFetch<{
    data?: InboxNotification[];
    pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  }>(
    `/notifications/user/${encodeURIComponent(userId)}?page=${page}&pageSize=${pageSize}${unread}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  if (!result.ok) {
    return {
      ok: false,
      kind: classifyListFailure(result.status),
      status: result.status,
      code: result.error?.code,
    };
  }
  const items = result.data?.data ?? [];
  const meta = result.data?.pagination;
  return {
    ok: true,
    items,
    meta: {
      page: meta?.page ?? page,
      pageSize: meta?.pageSize ?? pageSize,
      totalItems: meta?.total ?? items.length,
      totalPages: meta?.totalPages ?? 1,
    },
  };
}
