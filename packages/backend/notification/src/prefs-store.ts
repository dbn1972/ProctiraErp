/**
 * Notification preferences + device registration store.
 *
 * In-memory by default; when DATABASE_URL is set, persists prefs/devices
 * via raw `pg` against db/sql/005_notifications_schema.sql.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';

export type NotificationChannel = 'email' | 'in_app' | 'push' | 'webhook' | 'sms';
export type NotificationCategory =
  | 'academic'
  | 'attendance'
  | 'examination'
  | 'workflow'
  | 'system';
export type DigestFrequency = 'immediate' | 'daily' | 'weekly';

export interface CategoryPreference {
  category: NotificationCategory;
  channels: Record<NotificationChannel, boolean>;
}

export interface QuietHours {
  enabled: boolean;
  startTime: string;
  endTime: string;
  days: number[];
}

export interface NotificationPreferencesData {
  categories: CategoryPreference[];
  digestFrequency: DigestFrequency;
  quietHours: QuietHours;
}

export interface NotificationDevice {
  id: string;
  tenantId: string;
  userId: string;
  platform: 'ios' | 'android' | 'web';
  pushToken: string;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_CHANNELS: Record<NotificationChannel, boolean> = {
  email: true,
  in_app: true,
  push: true,
  webhook: false,
  sms: false,
};

const DEFAULT_CATEGORIES: NotificationCategory[] = [
  'academic',
  'attendance',
  'examination',
  'workflow',
  'system',
];

export function defaultPreferences(): NotificationPreferencesData {
  return {
    categories: DEFAULT_CATEGORIES.map((category) => ({
      category,
      channels: { ...DEFAULT_CHANNELS },
    })),
    digestFrequency: 'immediate',
    quietHours: {
      enabled: false,
      startTime: '22:00',
      endTime: '07:00',
      days: [0, 1, 2, 3, 4, 5, 6],
    },
  };
}

function mergePreferences(
  base: NotificationPreferencesData,
  patch: Partial<NotificationPreferencesData>,
): NotificationPreferencesData {
  return {
    categories: patch.categories ?? base.categories,
    digestFrequency: patch.digestFrequency ?? base.digestFrequency,
    quietHours: patch.quietHours ?? base.quietHours,
  };
}

export interface NotificationPrefsStore {
  getPreferences(tenantId: string, userId: string): Promise<NotificationPreferencesData>;
  updatePreferences(
    tenantId: string,
    userId: string,
    patch: Partial<NotificationPreferencesData>,
  ): Promise<NotificationPreferencesData>;
  registerDevice(
    input: Omit<NotificationDevice, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<NotificationDevice>;
  listDevices(tenantId: string, userId: string): Promise<NotificationDevice[]>;
  deleteDevice(tenantId: string, deviceId: string): Promise<boolean>;
}

export class InMemoryNotificationPrefsStore implements NotificationPrefsStore {
  private prefs = new Map<string, NotificationPreferencesData>();
  private devices = new Map<string, NotificationDevice>();

  private key(tenantId: string, userId: string): string {
    return `${tenantId}:${userId}`;
  }

  async getPreferences(tenantId: string, userId: string): Promise<NotificationPreferencesData> {
    return this.prefs.get(this.key(tenantId, userId)) ?? defaultPreferences();
  }

  async updatePreferences(
    tenantId: string,
    userId: string,
    patch: Partial<NotificationPreferencesData>,
  ): Promise<NotificationPreferencesData> {
    const current = await this.getPreferences(tenantId, userId);
    const next = mergePreferences(current, patch);
    this.prefs.set(this.key(tenantId, userId), next);
    return next;
  }

  async registerDevice(
    input: Omit<NotificationDevice, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<NotificationDevice> {
    for (const [id, existing] of this.devices) {
      if (existing.tenantId === input.tenantId && existing.pushToken === input.pushToken) {
        const updated: NotificationDevice = {
          ...existing,
          userId: input.userId,
          platform: input.platform,
          updatedAt: new Date(),
        };
        this.devices.set(id, updated);
        return { ...updated };
      }
    }
    const now = new Date();
    const entity: NotificationDevice = {
      id: input.id ?? randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      platform: input.platform,
      pushToken: input.pushToken,
      createdAt: now,
      updatedAt: now,
    };
    this.devices.set(entity.id, entity);
    return { ...entity };
  }

  async listDevices(tenantId: string, userId: string): Promise<NotificationDevice[]> {
    return [...this.devices.values()]
      .filter((d) => d.tenantId === tenantId && d.userId === userId)
      .map((d) => ({ ...d }));
  }

  async deleteDevice(tenantId: string, deviceId: string): Promise<boolean> {
    const existing = this.devices.get(deviceId);
    if (!existing || existing.tenantId !== tenantId) return false;
    this.devices.delete(deviceId);
    return true;
  }
}

export function isPgNotificationPrefsEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function createPgNotificationPrefsStore(): NotificationPrefsStore {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  return {
    async getPreferences(tenantId, userId) {
      const result = await pool.query(
        `SELECT categories, digest_frequency, quiet_hours
         FROM notification_preferences
         WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId],
      );
      const row = result.rows[0] as
        | {
            categories: CategoryPreference[];
            digest_frequency: DigestFrequency;
            quiet_hours: QuietHours;
          }
        | undefined;
      if (!row) return defaultPreferences();
      return {
        categories: row.categories,
        digestFrequency: row.digest_frequency,
        quietHours: row.quiet_hours,
      };
    },

    async updatePreferences(tenantId, userId, patch) {
      const current = await this.getPreferences(tenantId, userId);
      const next = mergePreferences(current, patch);
      await pool.query(
        `INSERT INTO notification_preferences
           (tenant_id, user_id, categories, digest_frequency, quiet_hours, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, now())
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET
           categories = EXCLUDED.categories,
           digest_frequency = EXCLUDED.digest_frequency,
           quiet_hours = EXCLUDED.quiet_hours,
           updated_at = now()`,
        [
          tenantId,
          userId,
          JSON.stringify(next.categories),
          next.digestFrequency,
          JSON.stringify(next.quietHours),
        ],
      );
      return next;
    },

    async registerDevice(input) {
      const id = input.id ?? randomUUID();
      const result = await pool.query(
        `INSERT INTO notification_devices
           (id, tenant_id, user_id, platform, push_token, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (tenant_id, push_token) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           platform = EXCLUDED.platform,
           updated_at = now()
         RETURNING id, tenant_id, user_id, platform, push_token, created_at, updated_at`,
        [id, input.tenantId, input.userId, input.platform, input.pushToken],
      );
      const row = result.rows[0] as {
        id: string;
        tenant_id: string;
        user_id: string;
        platform: 'ios' | 'android' | 'web';
        push_token: string;
        created_at: Date;
        updated_at: Date;
      };
      return {
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        platform: row.platform,
        pushToken: row.push_token,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    async listDevices(tenantId, userId) {
      const result = await pool.query(
        `SELECT id, tenant_id, user_id, platform, push_token, created_at, updated_at
         FROM notification_devices
         WHERE tenant_id = $1 AND user_id = $2
         ORDER BY updated_at DESC`,
        [tenantId, userId],
      );
      return (
        result.rows as Array<{
          id: string;
          tenant_id: string;
          user_id: string;
          platform: 'ios' | 'android' | 'web';
          push_token: string;
          created_at: Date;
          updated_at: Date;
        }>
      ).map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        platform: row.platform,
        pushToken: row.push_token,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },

    async deleteDevice(tenantId, deviceId) {
      const result = await pool.query(
        `DELETE FROM notification_devices WHERE tenant_id = $1 AND id = $2`,
        [tenantId, deviceId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}

export function createNotificationPrefsStore(): NotificationPrefsStore {
  return isPgNotificationPrefsEnabled()
    ? createPgNotificationPrefsStore()
    : new InMemoryNotificationPrefsStore();
}
