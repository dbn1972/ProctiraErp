/**
 * Notifications inbox (Server Component) — redesign Services surface.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
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
import { ListLoadFailure } from '@/components/route-state/list-load-failure';

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
  const [result, t] = await Promise.all([
    listUserNotifications(session.user.sub),
    getTranslations('notifications'),
  ]);
  const items = result.ok ? result.items : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/notifications/preferences">
              <Settings className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('preferences')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/notification-rules">{t('rules')}</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" aria-hidden="true" />
            {t('inbox')}
          </CardTitle>
          <CardDescription>{t('inboxDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {!result.ok ? (
            // PRC-M113: failure (incl. 403) is its own panel, never the empty inbox.
            <ListLoadFailure kind={result.kind} status={result.status} returnTo="/notifications" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t('empty')}
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
                      {` · ${item.readAt ? t('read') : t('unread')}`}
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
