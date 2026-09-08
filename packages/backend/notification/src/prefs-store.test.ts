/**
 * Prefs store unit tests — defaults, merge, device upsert.
 */
import { describe, expect, it } from 'vitest';

import {
  createPgNotificationPrefsStore,
  defaultPreferences,
  InMemoryNotificationPrefsStore,
} from './prefs-store.js';

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

describe('createPgNotificationPrefsStore (RLS binding)', () => {
  function fakePool() {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        if (text.includes('RETURNING')) {
          return {
            rows: [
              {
                id: 'dev-1',
                tenant_id: values?.[1],
                user_id: values?.[2],
                platform: values?.[3],
                push_token: values?.[4],
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    return { pool, calls };
  }

  it('binds app.tenant_id before every preferences/device statement', async () => {
    const { pool, calls } = fakePool();
    const store = createPgNotificationPrefsStore(pool);
    const tenantId = '00000000-0000-4000-8000-000000000001';

    await store.updatePreferences(tenantId, 'user-1', { digestFrequency: 'daily' });
    await store.registerDevice({ tenantId, userId: 'user-1', platform: 'web', pushToken: 't' });
    await store.listDevices(tenantId, 'user-1');
    await store.deleteDevice(tenantId, 'dev-1');

    const domainStatements = calls.filter((c) => /notification_(preferences|devices)/.test(c.text));
    expect(domainStatements.length).toBeGreaterThanOrEqual(5);
    for (const stmt of domainStatements) {
      const idx = calls.indexOf(stmt);
      const preceding = calls.slice(0, idx).map((c) => c.text);
      const bind = preceding.filter((t) => t.includes("set_config('app.tenant_id'"));
      expect(bind.length, `no tenant binding before: ${stmt.text.slice(0, 60)}`).toBeGreaterThan(0);
    }
    const bound = calls.filter((c) => c.text.includes("set_config('app.tenant_id'"));
    for (const b of bound) expect(b.values).toEqual([tenantId]);
  });
});
