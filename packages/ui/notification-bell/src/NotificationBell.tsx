'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMotionPreference } from '@proctira/ui-motion-gate';
import type { NotificationBellProps, Notification } from './types';

/**
 * NotificationBell component with real-time indicator and dropdown panel.
 * Meets WCAG 2.1 Level AA accessibility standards.
 *
 * @example
 * ```tsx
 * <NotificationBell
 *   notifications={notifications}
 *   unreadCount={3}
 *   hasRealTimeUpdates
 *   onNotificationClick={(n) => router.push(n.href)}
 *   onMarkAllRead={() => markAllRead()}
 * />
 * ```
 */
export function NotificationBell({
  notifications,
  unreadCount,
  hasRealTimeUpdates = false,
  onNotificationClick,
  onMarkAllRead,
  onMarkRead,
  onViewAll,
  maxVisible = 5,
  disabled = false,
  className = '',
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { disableMotion } = useMotionPreference();

  const effectiveUnreadCount = unreadCount ?? notifications.filter((n) => !n.read).length;
  const visibleNotifications = notifications.slice(0, maxVisible);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      onMarkRead?.(notification.id);
      onNotificationClick?.(notification);
      setIsOpen(false);
    },
    [onNotificationClick, onMarkRead],
  );

  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getTypeIcon = (type: Notification['type']): string => {
    switch (type) {
      case 'info':
        return 'ℹ️';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      case 'success':
        return '✅';
    }
  };

  return (
    <div ref={containerRef} className={`proctira-notification-bell ${className}`}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className="proctira-notification-bell__trigger"
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={`Notifications${effectiveUnreadCount > 0 ? `. ${effectiveUnreadCount} unread` : ''}`}
        disabled={disabled}
      >
        <span className="proctira-notification-bell__icon" aria-hidden="true">
          🔔
        </span>
        {effectiveUnreadCount > 0 && (
          <span className="proctira-notification-bell__badge" aria-hidden="true">
            {effectiveUnreadCount > 99 ? '99+' : effectiveUnreadCount}
          </span>
        )}
        {hasRealTimeUpdates && (
          <span
            className={`proctira-notification-bell__pulse${disableMotion ? ' proctira-notification-bell__pulse--reduced-motion' : ''}`}
            aria-hidden="true"
            title="New notifications available"
            data-reduced-motion={disableMotion ? 'true' : 'false'}
          />
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          className="proctira-notification-bell__panel"
          role="dialog"
          aria-label="Notifications"
          aria-modal="false"
        >
          {/* Header */}
          <div className="proctira-notification-bell__header">
            <h2 className="proctira-notification-bell__title">
              Notifications
              {effectiveUnreadCount > 0 && (
                <span className="proctira-notification-bell__count">
                  ({effectiveUnreadCount} unread)
                </span>
              )}
            </h2>
            {onMarkAllRead && effectiveUnreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="proctira-notification-bell__mark-all"
                aria-label="Mark all notifications as read"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          {visibleNotifications.length === 0 ? (
            <div className="proctira-notification-bell__empty" aria-live="polite">
              No notifications
            </div>
          ) : (
            <ul className="proctira-notification-bell__list" aria-label="Notification list">
              {visibleNotifications.map((notification) => (
                <li
                  key={notification.id}
                  className={`proctira-notification-bell__item ${!notification.read ? 'proctira-notification-bell__item--unread' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => handleNotificationClick(notification)}
                    className="proctira-notification-bell__item-btn"
                    aria-label={`${notification.read ? '' : 'Unread: '}${notification.title}. ${notification.message}. ${formatTime(notification.createdAt)}`}
                  >
                    <span className="proctira-notification-bell__item-icon" aria-hidden="true">
                      {notification.icon ?? getTypeIcon(notification.type)}
                    </span>
                    <div className="proctira-notification-bell__item-content">
                      <span className="proctira-notification-bell__item-title">
                        {notification.title}
                      </span>
                      <span className="proctira-notification-bell__item-message">
                        {notification.message}
                      </span>
                      <time
                        className="proctira-notification-bell__item-time"
                        dateTime={notification.createdAt}
                      >
                        {formatTime(notification.createdAt)}
                      </time>
                    </div>
                    {!notification.read && (
                      <span className="proctira-notification-bell__unread-dot" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Footer */}
          {onViewAll && notifications.length > maxVisible && (
            <div className="proctira-notification-bell__footer">
              <button
                type="button"
                onClick={() => {
                  onViewAll();
                  setIsOpen(false);
                }}
                className="proctira-notification-bell__view-all"
                aria-label="View all notifications"
              >
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
