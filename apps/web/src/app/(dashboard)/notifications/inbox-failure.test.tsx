/**
 * @vitest-environment jsdom
 *
 * PRC-M113 — a gateway 500 renders an error panel, a 403 a permission
 * message; neither is the empty inbox.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listUserNotifications = vi.fn();
vi.mock('@/lib/api/notifications-inbox', () => ({
  listUserNotifications: (...a: unknown[]) => listUserNotifications(...a),
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'u1' } })),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/notifications',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import Page from './page';

describe('notifications inbox failures (PRC-M113)', () => {
  beforeEach(() => listUserNotifications.mockReset());

  it('500 -> unavailable panel, not the empty state', async () => {
    listUserNotifications.mockResolvedValue({ ok: false, kind: 'unavailable', status: 500 });
    render(await Page({}));
    expect(screen.getByText('This list could not be loaded')).toBeTruthy();
    expect(screen.queryByText('empty')).toBeNull();
  });

  it('403 -> permission message', async () => {
    listUserNotifications.mockResolvedValue({ ok: false, kind: 'denied', status: 403 });
    render(await Page({}));
    expect(screen.getByText('You do not have access to this list')).toBeTruthy();
  });

  it('empty success -> empty state', async () => {
    listUserNotifications.mockResolvedValue({ ok: true, items: [] });
    render(await Page({}));
    expect(screen.getByText('empty')).toBeTruthy();
  });

  it('PRC-M114: unread filter and page go to the API; pager shown', async () => {
    listUserNotifications.mockResolvedValue({
      ok: true,
      items: [],
      meta: { page: 2, pageSize: 20, totalItems: 60, totalPages: 3 },
    });
    render(await Page({ searchParams: Promise.resolve({ filter: 'unread', page: '2' }) }));
    expect(listUserNotifications).toHaveBeenCalledWith('u1', {
      page: 2,
      pageSize: 20,
      unreadOnly: true,
    });
    expect(screen.getByRole('link', { name: 'filterUnread' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});
