/**
 * D2 CORRECTION (PRC-M015): platform_admin is the cross-tenant control-plane operator and
 * holds no tenant notification staff access. system_admin, the per-tenant admin, keeps it.
 *
 * Failing-first: fails while platform_admin is in ADMIN_ROLES, passes once it is removed.
 */
import { describe, expect, it } from 'vitest';
import { hasNotificationAccess } from './notification-access.js';
describe('notification-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED notification.staff; system_admin keeps it', () => {
    expect(hasNotificationAccess(['platform_admin'], 'notification.staff')).toBe(false);
    expect(hasNotificationAccess(['system_admin'], 'notification.staff')).toBe(true);
  });
});
