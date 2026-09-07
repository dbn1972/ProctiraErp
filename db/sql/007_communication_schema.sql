-- Communication module (raw SQL — no Prisma).
-- Campaigns and dual-confirm emergency blasts.
-- Actor columns are TEXT so local JWT `sub` (opaque) can persist.

CREATE TABLE IF NOT EXISTS comms_campaigns (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  channels TEXT[] NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '',
  audience_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comms_campaigns_tenant_status
  ON comms_campaigns (tenant_id, status);

CREATE TABLE IF NOT EXISTS comms_emergency_blasts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  reason TEXT NOT NULL,
  channels TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending_confirm'
    CHECK (status IN ('pending_confirm', 'confirmed', 'sent', 'cancelled')),
  confirm_actor_1 TEXT,
  confirm_actor_2 TEXT,
  confirmed_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comms_emergency_blasts_tenant_status
  ON comms_emergency_blasts (tenant_id, status);

-- Idempotent widen for installs that applied the earlier UUID actor columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'comms_campaigns' AND column_name = 'created_by'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE comms_campaigns ALTER COLUMN created_by TYPE TEXT USING created_by::text;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'comms_emergency_blasts' AND column_name = 'created_by'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE comms_emergency_blasts ALTER COLUMN created_by TYPE TEXT USING created_by::text;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'comms_emergency_blasts' AND column_name = 'confirm_actor_1'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE comms_emergency_blasts ALTER COLUMN confirm_actor_1 TYPE TEXT USING confirm_actor_1::text;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'comms_emergency_blasts' AND column_name = 'confirm_actor_2'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE comms_emergency_blasts ALTER COLUMN confirm_actor_2 TYPE TEXT USING confirm_actor_2::text;
  END IF;
END $$;
