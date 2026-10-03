/**
 * @vitest-environment jsdom
 *
 * PRC-M115 — the inbox can mark one/all read (header bell is told to
 * refetch), shows a visual + sr-only unread indicator, and formats times in
 * the viewer's zone with the zone named.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listUserNotifications = vi.fn();
const gatewayFetch = vi.fn();
const refresh = vi.fn();
vi.mock('@/lib/api/notifications-inbox', () => ({
  listUserNotifications: (...a: unknown[]) => listUserNotifications(...a),
}));
vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...a: unknown[]) => gatewayFetch(...a),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'u1' } })),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/notifications',
  useRouter: () => ({ push: vi.fn(), refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

import Page from './page';
import { markAllNotificationsReadAction, markNotificationReadAction } from './actions';
import { formatLocalDateTime } from './_components/inbox-controls';

const row = (id: string, readAt: string | null) => ({
  id,
  channel: 'in_app',
  templateId: 't',
  recipientUserId: 'u1',
  variables: { title: `Title ${id}` },
  status: 'sent',
  priority: '',
  readAt,
  sentAt: null,
  createdAt: '2025-01-15T09:30:00.000Z',
});

describe('notifications mark-read (PRC-M115)', () => {
  beforeEach(() => {
    listUserNotifications.mockReset();
    gatewayFetch.mockReset();
    refresh.mockReset();
  });

  it('clicking mark-read posts, refreshes the row and pings the header count', async () => {
    listUserNotifications.mockResolvedValue({ ok: true, items: [row('n1', null), row('n2', 'x')] });
    gatewayFetch.mockResolvedValue({ ok: true, data: {} });
    const changed = vi.fn();
    window.addEventListener('proctira:notifications-changed', changed);
    render(await Page({}));
    // Only the unread row has a per-item control; sr-only state labels are present.
    const buttons = screen.getAllByTestId('notification-mark-read');
    expect(buttons).toHaveLength(1);
    expect(screen.getByText('unread:', { exact: false })).toBeTruthy();
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(gatewayFetch).toHaveBeenCalledWith(
      '/notifications/n1/read',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(changed).toHaveBeenCalled();
  });

  it('a failed mark shows an alert and does not refresh', async () => {
    listUserNotifications.mockResolvedValue({ ok: true, items: [row('n1', null)] });
    gatewayFetch.mockResolvedValue({ ok: false, status: 500 });
    render(await Page({}));
    fireEvent.click(screen.getByTestId('notification-mark-read'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('rejects a path-traversal id without calling the gateway', async () => {
    expect(await markNotificationReadAction('../x')).toEqual({ ok: false, marked: 0 });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('mark all marks every unread row', async () => {
    listUserNotifications
      .mockResolvedValueOnce({ ok: true, items: [row('a', null), row('b', null)] })
      .mockResolvedValueOnce({ ok: true, items: [] });
    gatewayFetch.mockResolvedValue({ ok: true, data: {} });
    expect(await markAllNotificationsReadAction()).toEqual({ ok: true, marked: 2 });
    expect(gatewayFetch).toHaveBeenCalledTimes(2);
  });

  it('timestamps are formatted for a zone and name the zone', () => {
    const text = formatLocalDateTime('2025-01-15T09:30:00.000Z', 'en-GB', 'Asia/Kolkata');
    expect(text).toContain('15:00');
    expect(text).toMatch(/GMT\+5:30|IST/);
  });
});
