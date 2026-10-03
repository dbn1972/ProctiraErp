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
import { PaginationControls } from '@/components/institutions/pagination-controls';
import { LocalTime, MarkAllReadButton, MarkReadButton } from './_components/inbox-controls';

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

export default async function NotificationsInboxPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const sp = (await props.searchParams) ?? {};
  // PRC-M114: server-side paging and an unread filter.
  const page = Math.max(1, Number(typeof sp.page === 'string' ? sp.page : 1) || 1);
  const unreadOnly = sp.filter === 'unread';
  const PAGE_SIZE = 20;
  const [result, t] = await Promise.all([
    listUserNotifications(session.user.sub, { page, pageSize: PAGE_SIZE, unreadOnly }),
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
          <MarkAllReadButton />
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
          <nav aria-label={t('filterLabel')} className="flex gap-2 pt-2 text-sm">
            <Link
              href="/notifications"
              aria-current={!unreadOnly ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-md px-3 ${!unreadOnly ? 'bg-muted font-semibold' : 'text-muted-foreground'}`}
            >
              {t('filterAll')}
            </Link>
            <Link
              href="/notifications?filter=unread"
              aria-current={unreadOnly ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-md px-3 ${unreadOnly ? 'bg-muted font-semibold' : 'text-muted-foreground'}`}
            >
              {t('filterUnread')}
            </Link>
          </nav>
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
              {items.map((item) => {
                const title = titleFor(item);
                const unread = !item.readAt;
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
                    data-testid="notification-inbox-row"
                    data-unread={unread ? 'true' : 'false'}
                  >
                    <div className="flex items-start gap-2">
                      {/* PRC-M115: visual + screen-reader unread indicator. */}
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`}
                      />
                      <div>
                        <p className={`text-sm text-foreground ${unread ? 'font-semibold' : 'font-medium'}`}>
                          <span className="sr-only">{unread ? `${t('unread')}: ` : `${t('read')}: `}</span>
                          {title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.channel} · {item.status}
                          {item.priority ? ` · ${item.priority}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <LocalTime iso={item.createdAt} />
                      {unread ? <MarkReadButton id={item.id} label={title} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {result.ok && (result.meta?.totalPages ?? 1) > 1 ? (
            <div className="mt-4 border-t pt-3">
              <PaginationControls
                page={result.meta?.page ?? page}
                pageSize={result.meta?.pageSize ?? PAGE_SIZE}
                totalItems={result.meta?.totalItems ?? items.length}
                totalPages={result.meta?.totalPages ?? 1}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
