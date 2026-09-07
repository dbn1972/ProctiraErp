-- Notifications foundation (raw SQL — no Prisma).
-- Prefs + devices + delivery records for cert / live Postgres path.
-- user_id / recipient_user_id are TEXT so opaque JWT `sub` values persist.

CREATE TABLE IF NOT EXISTS notification_preferences (
  tenant_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  digest_frequency TEXT NOT NULL DEFAULT 'immediate'
    CHECK (digest_frequency IN ('immediate', 'daily', 'weekly')),
  quiet_hours JSONB NOT NULL DEFAULT '{"enabled":false,"startTime":"22:00","endTime":"07:00","days":[0,1,2,3,4,5,6]}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS notification_devices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  push_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, push_token)
);

CREATE INDEX IF NOT EXISTS idx_notification_devices_tenant_user
  ON notification_devices (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  channel TEXT NOT NULL
    CHECK (channel IN ('email', 'in_app', 'push', 'webhook', 'sms')),
  template_id UUID NOT NULL,
  recipient_user_id TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL
    CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 3,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  webhook_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_recipient
  ON notifications (tenant_id, recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_status
  ON notifications (tenant_id, status);

-- Idempotent widen for installs that applied earlier UUID user columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_preferences' AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE notification_preferences ALTER COLUMN user_id TYPE TEXT USING user_id::text;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_devices' AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE notification_devices ALTER COLUMN user_id TYPE TEXT USING user_id::text;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'recipient_user_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE notifications ALTER COLUMN recipient_user_id TYPE TEXT USING recipient_user_id::text;
  END IF;
END $$;
