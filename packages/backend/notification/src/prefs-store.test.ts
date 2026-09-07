/**
 * Prefs store unit tests — defaults, merge, device upsert.
 */
import { describe, expect, it } from 'vitest';

import { defaultPreferences, InMemoryNotificationPrefsStore } from './prefs-store.js';

describe('InMemoryNotificationPrefsStore', () => {
  it('returns defaults then merges patch', async () => {
    const store = new InMemoryNotificationPrefsStore();
    const tenantId = '00000000-0000-4000-8000-0000000000aa';
    const userId = '00000000-0000-4000-8000-000000000001';

    const initial = await store.getPreferences(tenantId, userId);
    expect(initial).toEqual(defaultPreferences());

    const updated = await store.updatePreferences(tenantId, userId, {
      digestFrequency: 'weekly',
      quietHours: {
        enabled: true,
        startTime: '21:00',
        endTime: '06:00',
        days: [1, 2, 3, 4, 5],
      },
    });
    expect(updated.digestFrequency).toBe('weekly');
    expect(updated.quietHours.enabled).toBe(true);
    expect(updated.categories).toEqual(initial.categories);
  });

  it('registers and lists devices; upserts by push token', async () => {
    const store = new InMemoryNotificationPrefsStore();
    const tenantId = '00000000-0000-4000-8000-0000000000aa';
    const userId = '00000000-0000-4000-8000-000000000001';

    const first = await store.registerDevice({
      tenantId,
      userId,
      platform: 'android',
      pushToken: 'token-1',
    });
    const second = await store.registerDevice({
      tenantId,
      userId,
      platform: 'ios',
      pushToken: 'token-1',
    });
    expect(second.id).toBe(first.id);
    expect(second.platform).toBe('ios');

    const listed = await store.listDevices(tenantId, userId);
    expect(listed).toHaveLength(1);

    expect(await store.deleteDevice(tenantId, first.id)).toBe(true);
    expect(await store.listDevices(tenantId, userId)).toHaveLength(0);
  });
});
