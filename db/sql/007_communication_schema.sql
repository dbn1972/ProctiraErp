-- Communication module (raw SQL — no Prisma).
-- Campaigns and dual-confirm emergency blasts.

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
  created_by UUID,
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
  confirm_actor_1 UUID,
  confirm_actor_2 UUID,
  confirmed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comms_emergency_blasts_tenant_status
  ON comms_emergency_blasts (tenant_id, status);
