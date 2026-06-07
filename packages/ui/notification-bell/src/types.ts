export interface Notification {
  /** Unique notification ID */
  id: string;
  /** Notification title */
  title: string;
  /** Notification message body */
  message: string;
  /** Notification type/category */
  type: 'info' | 'warning' | 'error' | 'success';
  /** Whether the notification has been read */
  read: boolean;
  /** Timestamp when the notification was created */
  createdAt: string;
  /** Optional link to navigate to */
  href?: string;
  /** Optional icon */
  icon?: string;
}

export interface NotificationBellProps {
  /** List of notifications to display */
  notifications: Notification[];
  /** Number of unread notifications (can differ from filtered list) */
  unreadCount?: number;
  /** Whether there are real-time updates available */
  hasRealTimeUpdates?: boolean;
  /** Callback when a notification is clicked */
  onNotificationClick?: (notification: Notification) => void;
  /** Callback when mark all as read is clicked */
  onMarkAllRead?: () => void;
  /** Callback when a single notification is marked as read */
  onMarkRead?: (notificationId: string) => void;
  /** Callback when "View All" is clicked */
  onViewAll?: () => void;
  /** Maximum notifications to show in dropdown */
  maxVisible?: number;
  /** Whether the bell is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
}
