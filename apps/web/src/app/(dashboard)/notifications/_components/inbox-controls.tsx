'use client';
/**
 * PRC-M115 — mark-read controls and a local-time timestamp for the inbox.
 * After a successful mark the page is refreshed and the header bell is told
 * to refetch its unread count via a window event.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@proctira/ui/components';
import { markAllNotificationsReadAction, markNotificationReadAction } from '../actions';

export const NOTIFICATIONS_CHANGED_EVENT = 'proctira:notifications-changed';

function useMark(run: () => Promise<{ ok: boolean; marked: number }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const trigger = () => {
    setFailed(false);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) setFailed(true);
      if (result.marked > 0) {
        window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
        router.refresh();
      }
    });
  };
  return { pending, failed, trigger };
}

export function MarkReadButton({ id, label }: { id: string; label: string }) {
  const t = useTranslations('notifications');
  const { pending, failed, trigger } = useMark(() => markNotificationReadAction(id));
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="min-h-11"
        onClick={trigger}
        disabled={pending}
        aria-label={`${t('markRead')}: ${label}`}
        data-testid="notification-mark-read"
      >
        {t('markRead')}
      </Button>
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {t('markReadFailed')}
        </span>
      ) : null}
    </span>
  );
}

export function MarkAllReadButton() {
  const t = useTranslations('notifications');
  const { pending, failed, trigger } = useMark(() => markAllNotificationsReadAction());
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={trigger}
        disabled={pending}
        data-testid="notification-mark-all-read"
      >
        {t('markAllRead')}
      </Button>
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {t('markReadFailed')}
        </span>
      ) : null}
    </span>
  );
}

/** Formats an ISO instant in the viewer's locale and time zone, with the zone shown. */
export function formatLocalDateTime(iso: string, locale?: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function LocalTime({ iso }: { iso: string }) {
  // Server render shows UTC labelled as such; the client swaps in the viewer's zone.
  const [text, setText] = useState(() => formatLocalDateTime(iso, 'en-GB', 'UTC'));
  useEffect(() => {
    setText(formatLocalDateTime(iso, navigator.language));
  }, [iso]);
  return (
    <time className="text-xs text-muted-foreground" dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
