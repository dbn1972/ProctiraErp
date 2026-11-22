import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { NotificationBell } from './NotificationBell';
import type { Notification } from './types';

/**
 * PRC-L597 — widget-level axe-core WCAG 2.1 AA gate for `<NotificationBell>`.
 * Exercises the empty state and a populated unread state so the bell trigger's
 * accessible name, the unread-count badge and the notification list markup are
 * checked by axe.
 *
 * Regression gate (not failing-first): asserts the current contract and
 * guards it going forward.
 */
const notifications: Notification[] = [
  {
    id: '1',
    title: 'Fee reminder',
    message: 'Term 2 fees are due on 15 November.',
    type: 'warning',
    read: false,
    createdAt: new Date('2026-10-01T09:00:00Z').toISOString(),
  },
  {
    id: '2',
    title: 'Report ready',
    message: 'The attendance report has finished generating.',
    type: 'success',
    read: true,
    createdAt: new Date('2026-10-02T09:00:00Z').toISOString(),
  },
];

describe('<NotificationBell /> — axe-core WCAG 2.1 AA gate (PRC-L597)', () => {
  it('empty state has no violations', async () => {
    const { container } = render(
      <NotificationBell notifications={[]} unreadCount={0} locale="en" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('populated unread state has no violations', async () => {
    const { container } = render(
      <NotificationBell
        notifications={notifications}
        unreadCount={1}
        onNotificationClick={vi.fn()}
        onMarkAllRead={vi.fn()}
        onViewAll={vi.fn()}
        locale="en"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('disabled bell retains an accessible name', async () => {
    const { container } = render(
      <NotificationBell notifications={notifications} unreadCount={1} disabled locale="en" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
