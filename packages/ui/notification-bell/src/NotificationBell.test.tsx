import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';
import type { Notification } from './types';

const testNotifications: Notification[] = [
  {
    id: '1',
    title: 'New Student Enrolled',
    message: 'Alice has been enrolled in Grade 5',
    type: 'info',
    read: false,
    createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
  },
  {
    id: '2',
    title: 'Transfer Approved',
    message: 'Bob transfer to School B approved',
    type: 'success',
    read: false,
    createdAt: new Date(Date.now() - 60 * 60000).toISOString(),
  },
  {
    id: '3',
    title: 'Report Ready',
    message: 'Monthly attendance report is ready',
    type: 'info',
    read: true,
    createdAt: new Date(Date.now() - 24 * 60 * 60000).toISOString(),
  },
];

describe('NotificationBell', () => {
  it('renders bell button', () => {
    render(
      <NotificationBell notifications={testNotifications} />
    );

    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
  });

  it('shows unread count badge', () => {
    render(
      <NotificationBell notifications={testNotifications} unreadCount={2} />
    );

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calculates unread count from notifications when not provided', () => {
    render(
      <NotificationBell notifications={testNotifications} />
    );

    const button = screen.getByRole('button', { name: /notifications.*2 unread/i });
    expect(button).toBeInTheDocument();
  });

  it('opens notification panel on click', () => {
    render(
      <NotificationBell notifications={testNotifications} />
    );

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));

    expect(screen.getByRole('dialog', { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByText('New Student Enrolled')).toBeInTheDocument();
    expect(screen.getByText('Transfer Approved')).toBeInTheDocument();
  });

  it('calls onNotificationClick when a notification is clicked', () => {
    const onNotificationClick = vi.fn();
    render(
      <NotificationBell
        notifications={testNotifications}
        onNotificationClick={onNotificationClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    fireEvent.click(screen.getByRole('button', { name: /new student enrolled/i }));

    expect(onNotificationClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', title: 'New Student Enrolled' })
    );
  });

  it('calls onMarkRead when a notification is clicked', () => {
    const onMarkRead = vi.fn();
    render(
      <NotificationBell
        notifications={testNotifications}
        onMarkRead={onMarkRead}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    fireEvent.click(screen.getByRole('button', { name: /new student enrolled/i }));

    expect(onMarkRead).toHaveBeenCalledWith('1');
  });

  it('shows mark all read button and calls onMarkAllRead', () => {
    const onMarkAllRead = vi.fn();
    render(
      <NotificationBell
        notifications={testNotifications}
        onMarkAllRead={onMarkAllRead}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));

    const markAllBtn = screen.getByRole('button', { name: /mark all notifications as read/i });
    fireEvent.click(markAllBtn);

    expect(onMarkAllRead).toHaveBeenCalled();
  });

  it('shows real-time indicator when hasRealTimeUpdates is true', () => {
    render(
      <NotificationBell
        notifications={testNotifications}
        hasRealTimeUpdates
      />
    );

    const pulse = document.querySelector('.proctira-notification-bell__pulse');
    expect(pulse).toBeInTheDocument();
  });

  it('shows empty state when no notifications', () => {
    render(
      <NotificationBell notifications={[]} />
    );

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('limits visible notifications to maxVisible', () => {
    render(
      <NotificationBell notifications={testNotifications} maxVisible={1} onViewAll={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));

    expect(screen.getByText('New Student Enrolled')).toBeInTheDocument();
    expect(screen.queryByText('Transfer Approved')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view all notifications/i })).toBeInTheDocument();
  });

  it('disables bell when disabled', () => {
    render(
      <NotificationBell notifications={testNotifications} disabled />
    );

    expect(screen.getByRole('button', { name: /notifications/i })).toBeDisabled();
  });

  it('has proper WCAG attributes', () => {
    render(
      <NotificationBell notifications={testNotifications} />
    );

    const button = screen.getByRole('button', { name: /notifications/i });
    expect(button).toHaveAttribute('aria-haspopup', 'true');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
