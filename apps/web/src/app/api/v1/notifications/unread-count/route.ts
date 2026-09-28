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
    const items = await listUserNotifications(session.user.sub);
    const unread = items.filter((item) => !item.readAt).length;
    return NextResponse.json({ unread }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ unread: 0 }, { headers: { 'cache-control': 'no-store' } });
  }
}
