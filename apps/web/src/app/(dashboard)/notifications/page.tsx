/**
 * Notifications inbox + preferences (Server Component).
 *
 * Layout per redesign/web/notifications-center.html:
 *  - Page head with unread count
 *  - Inbox / Preferences tabs
 *  - Inbox list of in-app / email / push deliveries
 *  - Preferences tab reuses NotificationPreferences (settings feature)
 */
import Link from 'next/link';
import { Bell } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import {
  type DeliveryStatus,
  type NotificationItem,
} from '@/lib/api/notifications';
import { listMyNotifications } from '@/lib/api/notifications.server';
import { cn } from '@/lib/utils';
import NotificationPreferences from '@/features/settings/pages/NotificationPreferences';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
};

const STATUS_COLOURS: Record<DeliveryStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  sent: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
  delivered: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  read: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

const CHANNEL_LABELS: Record<NotificationItem['channel'], string> = {
  email: 'Email',
  in_app: 'In-app',
  push: 'Push',
  webhook: 'Webhook',
};

export default async function NotificationsPage({ searchParams }: PageProps) {
  const tab = single(searchParams?.tab) === 'preferences' ? 'preferences' : 'inbox';
  const notifications = tab === 'inbox' ? await listMyNotifications() : [];
  const unreadCount = notifications.filter(
    (n) => n.status !== 'read' && n.status !== 'failed',
  ).length;

  return (
    <section aria-labelledby="notifications-heading" className="space-y-6">
      <div>
        <h1
          id="notifications-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Notifications
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tab === 'preferences'
            ? 'Choose channels, digests, and quiet hours for your account'
            : `Alerts, approvals and system messages for your account${
                notifications.length > 0
                  ? ` · ${unreadCount.toLocaleString()} unread of ${notifications.length.toLocaleString()}`
                  : ''
              }`}
        </p>
      </div>

      <div
        className="flex flex-wrap gap-1 border-b border-border"
        role="tablist"
        aria-label="Notifications sections"
      >
        <Link
          href="/notifications"
          role="tab"
          aria-selected={tab === 'inbox'}
          className={cn(
            'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
            tab === 'inbox'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Inbox
          {tab === 'inbox' && notifications.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
              {notifications.length.toLocaleString()}
            </span>
          ) : null}
        </Link>
        <Link
          href="/notifications?tab=preferences"
          role="tab"
          aria-selected={tab === 'preferences'}
          className={cn(
            'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
            tab === 'preferences'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Preferences
        </Link>
      </div>

      {tab === 'preferences' ? (
        <NotificationPreferences embedded />
      ) : notifications.length === 0 ? (
        <EmptyState />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inbox</CardTitle>
            <CardDescription>
              Latest {notifications.length.toLocaleString()} deliveries
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y" role="list" aria-label="Notifications">
              {notifications.map((item) => (
                <NotificationRow key={item.id} item={item} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Bell className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-base font-medium">No notifications</p>
        <p className="text-sm text-muted-foreground">
          Sign in to see your inbox, or check back when new alerts arrive.
        </p>
      </CardContent>
    </Card>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const unread = item.status !== 'read';
  const title =
    item.variables.title ||
    item.variables.subject ||
    item.templateId ||
    'Notification';
  const excerpt =
    item.variables.body ||
    item.variables.message ||
    item.failureReason ||
    null;
  const when = item.readAt || item.deliveredAt || item.sentAt || item.createdAt;

  return (
    <li
      className={cn(
        'flex gap-3 px-4 py-4 sm:px-5',
        unread && 'bg-primary/5',
      )}
    >
      <span
        className={cn(
          'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          unread
            ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
            : 'bg-muted text-muted-foreground',
        )}
        aria-hidden="true"
      >
        <Bell className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
              STATUS_COLOURS[item.status],
            )}
          >
            {STATUS_LABELS[item.status]}
          </span>
        </div>
        {excerpt ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{excerpt}</p>
        ) : null}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {CHANNEL_LABELS[item.channel]}
          <span aria-hidden="true"> · </span>
          <span className="font-mono">{item.templateId}</span>
          {when ? (
            <>
              <span aria-hidden="true"> · </span>
              {when}
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}
