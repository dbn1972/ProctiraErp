'use server';
/**
 * PRC-M115 — inbox mark-read actions. The gateway enforces recipient
 * ownership (PRC-H070); ids are validated before interpolation into a path.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { gatewayFetch } from '@/lib/api/gateway';
import { listUserNotifications } from '@/lib/api/notifications-inbox';
import { requireSession } from '@/lib/auth/server';

const notificationIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export type MarkReadResult = { ok: true; marked: number } | { ok: false; marked: number };

async function markOne(id: string): Promise<boolean> {
  const result = await gatewayFetch(`/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    cache: 'no-store',
    throwOnError: false,
  });
  return result.ok;
}

export async function markNotificationReadAction(id: string): Promise<MarkReadResult> {
  const parsed = notificationIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, marked: 0 };
  await requireSession();
  const ok = await markOne(parsed.data);
  if (ok) revalidatePath('/notifications');
  return ok ? { ok: true, marked: 1 } : { ok: false, marked: 0 };
}

/** Upper bound of unread rows marked per click (5 pages × 100). */
const MARK_ALL_MAX_PAGES = 5;

export async function markAllNotificationsReadAction(): Promise<MarkReadResult> {
  const session = await requireSession();
  let marked = 0;
  for (let i = 0; i < MARK_ALL_MAX_PAGES; i += 1) {
    // Always read page 1: rows marked read drop out of the unread filter.
    const page = await listUserNotifications(session.user.sub, {
      unreadOnly: true,
      page: 1,
      pageSize: 100,
    });
    if (!page.ok) {
      if (marked > 0) revalidatePath('/notifications');
      return { ok: false, marked };
    }
    const ids = page.items.filter((n) => !n.readAt).map((n) => n.id);
    if (ids.length === 0) break;
    const results = await Promise.all(ids.map((id) => markOne(id)));
    const okCount = results.filter(Boolean).length;
    marked += okCount;
    if (okCount < ids.length) {
      revalidatePath('/notifications');
      return { ok: false, marked };
    }
    if (ids.length < 100) break;
  }
  revalidatePath('/notifications');
  return { ok: true, marked };
}
