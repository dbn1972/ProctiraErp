/**
 * Tests for the server-side notifications inbox client (Task 3.3).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();

vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
}));

import { getUnreadNotificationCount, listUserNotifications } from './notifications-inbox';

describe('notifications-inbox client', () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
  });

  describe('getUnreadNotificationCount', () => {
    it('returns the count on a successful gateway response', async () => {
      gatewayFetch.mockResolvedValue({ status: 200, ok: true, data: { count: 7 } });

      const count = await getUnreadNotificationCount('user-1');

      expect(count).toBe(7);
      expect(gatewayFetch).toHaveBeenCalledWith(
        '/notifications/user/user-1/unread-count',
        expect.objectContaining({ throwOnError: false }),
      );
    });

    it('encodes the userId in the path', async () => {
      gatewayFetch.mockResolvedValue({ status: 200, ok: true, data: { count: 0 } });

      await getUnreadNotificationCount('user id/with space');

      expect(gatewayFetch.mock.calls[0]?.[0]).toBe(
        '/notifications/user/user%20id%2Fwith%20space/unread-count',
      );
    });

    it('returns 0 when the gateway call fails', async () => {
      gatewayFetch.mockResolvedValue({
        status: 500,
        ok: false,
        data: null,
        error: { code: 'GATEWAY_ERROR', message: 'boom' },
      });

      const count = await getUnreadNotificationCount('user-1');

      expect(count).toBe(0);
    });

    it('returns 0 when the gateway is unreachable', async () => {
      gatewayFetch.mockResolvedValue({
        status: 0,
        ok: false,
        data: null,
        error: { code: 'NETWORK_ERROR', message: 'ECONNREFUSED' },
      });

      const count = await getUnreadNotificationCount('user-1');

      expect(count).toBe(0);
    });
  });

  describe('listUserNotifications', () => {
    it('returns the notification list on a successful gateway response', async () => {
      const notification = {
        id: 'n1',
        channel: 'in_app',
        templateId: 't1',
        recipientUserId: 'user-1',
        variables: {},
        status: 'sent',
        priority: 'normal',
        readAt: null,
        sentAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      gatewayFetch.mockResolvedValue({ status: 200, ok: true, data: { data: [notification] } });

      const result = await listUserNotifications('user-1');

      expect(result).toEqual([notification]);
      expect(gatewayFetch.mock.calls[0]?.[0]).toBe(
        '/notifications/user/user-1?page=1&pageSize=50',
      );
    });

    it('returns an empty array when the gateway call fails', async () => {
      gatewayFetch.mockResolvedValue({
        status: 503,
        ok: false,
        data: null,
        error: { code: 'GATEWAY_ERROR', message: 'unavailable' },
      });

      const result = await listUserNotifications('user-1');

      expect(result).toEqual([]);
    });
  });
});
