import { describe, expect, it } from 'vitest';

import {
  assertNotificationAccess,
  hasNotificationAccess,
  isNotificationStaffPath,
  notificationActionForPath,
  normalizeNotificationRoles,
} from './notification-access.js';

describe('notification-access (W1-SEC-02)', () => {
  it('normalizes roles', () => {
    expect(normalizeNotificationRoles(['Admin', { roleName: 'Notification_Officer' }])).toEqual([
      'admin',
      'notification_officer',
    ]);
  });

  it('allows staff to broadcast', () => {
    expect(hasNotificationAccess(['notification_admin'], 'notification.staff')).toBe(true);
    expect(hasNotificationAccess(['admin'], 'notification.staff')).toBe(true);
  });

  it('denies teachers on staff actions; allows self when user present', () => {
    expect(hasNotificationAccess(['teacher'], 'notification.staff')).toBe(false);
    expect(hasNotificationAccess(['teacher'], 'notification.self', { hasUser: true })).toBe(true);
    expect(hasNotificationAccess([], 'notification.self', { hasUser: false })).toBe(false);
    expect(() => assertNotificationAccess(['viewer'], 'notification.staff')).toThrow(/Forbidden/);
  });

  it('classifies staff paths', () => {
    expect(isNotificationStaffPath('/notifications/send')).toBe(true);
    expect(isNotificationStaffPath('/notifications/rules')).toBe(true);
    expect(isNotificationStaffPath('/notifications/templates')).toBe(true);
    expect(isNotificationStaffPath('/notifications/preferences')).toBe(false);
    expect(isNotificationStaffPath('/notifications/devices')).toBe(false);
    expect(notificationActionForPath('/api/v1/notifications/send')).toBe('notification.staff');
  });
});
