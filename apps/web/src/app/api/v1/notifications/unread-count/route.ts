/**
 * Same-origin unread count for the header bell (`NotificationBell`,
 * `@/components/layout/header.tsx`).
 *
 * Delegates to `getUnreadNotificationCount()` (`@/lib/api/notifications-inbox`),
 * which calls the real `GET /notifications/user/:userId/unread-count`
 * gateway endpoint (Task 3.2, `principal-dashboard-parity`) — a single
 * indexed `COUNT(*)` query (optionally Redis-cached, Task 3.5) — rather
 * than fetching every notification and counting unread rows client-side.
 * A missing/expired session or a failed upstream call both degrade to
 * zero, so the bell never shows an error state or a stale count.
 */
import { NextResponse } from 'next/server';

import { getUnreadNotificationCount } from '@/lib/api/notifications-inbox';
import { getSession } from '@/lib/auth/server';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session || session.isExpired) {
    return NextResponse.json({ unread: 0 }, { headers: { 'cache-control': 'no-store' } });
  }

  const unread = await getUnreadNotificationCount(session.user.sub).catch(() => 0);
  return NextResponse.json({ unread }, { headers: { 'cache-control': 'no-store' } });
}
