/**
 * Same-origin unread count for the header bell.
 * Counts inbox rows with no readAt. A missing session or a failed inbox
 * read returns zero so the bell does not invent a dot.
 */
import { NextResponse } from 'next/server';

import { listUserNotifications } from '@/lib/api/notifications-inbox';
import { getSession } from '@/lib/auth/server';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session || session.isExpired) {
    return NextResponse.json({ unread: 0 }, { headers: { 'cache-control': 'no-store' } });
  }

  try {
    // PRC-M114: server-side unread filter; the total is the count (not capped at a page).
    const result = await listUserNotifications(session.user.sub, { unreadOnly: true, pageSize: 1 });
    const unread = result.ok ? (result.meta?.totalItems ?? result.items.length) : 0;
    return NextResponse.json({ unread }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ unread: 0 }, { headers: { 'cache-control': 'no-store' } });
  }
}
