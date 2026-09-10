/**
 * Notifications inbox (Server Component) — redesign Services surface.
 */
import Link from 'next/link';
import { Bell, Settings } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listUserNotifications } from '@/lib/api/notifications-inbox';

export const dynamic = 'force-dynamic';

function titleFor(n: { templateId: string; variables: Record<string, string> }): string {
  return (
    n.variables['title'] ??
    n.variables['subject'] ??
    n.variables['message'] ??
    n.templateId ??
    'Notification'
  );
}

export default async function NotificationsInboxPage() {
  const session = await requireSession();
  const items = await listUserNotifications(session.user.sub);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            In-app inbox for your school alerts. Manage email, push, and SMS preferences anytime.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/notifications/preferences">
              <Settings className="me-1.5 h-4 w-4" aria-hidden="true" />
              Preferences
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/notification-rules">Notification rules</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" aria-hidden="true" />
            Inbox
          </CardTitle>
          <CardDescription>Alerts for your signed-in account.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No notifications yet. Use Preferences to choose email, push, or SMS — and register a
              device when you want mobile alerts.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  data-testid="notification-inbox-row"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{titleFor(item)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.channel} · {item.status}
                      {item.priority ? ` · ${item.priority}` : ''}
                      {item.readAt ? ' · read' : ' · unread'}
                    </p>
                  </div>
                  <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                    {item.createdAt.slice(0, 16).replace('T', ' ')}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
