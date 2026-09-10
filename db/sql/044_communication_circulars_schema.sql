-- Communication circulars + delivery log (Wave 9 / G-922).
-- Raw SQL — applied after 036 via tools/scripts/apply-sql.sh.
--
-- Complements 007_communication_schema.sql (campaigns / emergency blasts).
-- WhatsApp live provider is not called from application code; sandbox adapters
-- write rows here. Future live adapter env vars (unused in this slice):
--   WHATSAPP_PROVIDER, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
--   WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_WEBHOOK_VERIFY_TOKEN,
--   WHATSAPP_API_BASE_URL

CREATE TABLE IF NOT EXISTS comms_circulars (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  audience_type TEXT NOT NULL
    CHECK (audience_type IN ('all', 'roles', 'classes', 'institution')),
  audience_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  requires_ack BOOLEAN NOT NULL DEFAULT false,
  channels TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent')),
  created_by TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comms_circulars_tenant_status_idx
  ON comms_circulars (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_circular_acks (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  circular_id UUID NOT NULL REFERENCES comms_circulars(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL,
  recipient_label TEXT,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, circular_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS comms_circular_acks_circular_idx
  ON comms_circular_acks (tenant_id, circular_id);

CREATE TABLE IF NOT EXISTS comms_delivery_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  channel TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipient_label TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  provider_ref TEXT,
  source_type TEXT NOT NULL DEFAULT 'circular'
    CHECK (source_type IN ('campaign', 'emergency', 'circular')),
  source_id UUID,
  error_message TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  retried_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comms_delivery_log_tenant_status_idx
  ON comms_delivery_log (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS comms_delivery_log_tenant_channel_idx
  ON comms_delivery_log (tenant_id, channel, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 030; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE comms_circulars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON comms_circulars;
CREATE POLICY tenant_isolation ON comms_circulars
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE comms_circulars FORCE ROW LEVEL SECURITY;

ALTER TABLE comms_circular_acks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON comms_circular_acks;
CREATE POLICY tenant_isolation ON comms_circular_acks
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE comms_circular_acks FORCE ROW LEVEL SECURITY;

ALTER TABLE comms_delivery_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON comms_delivery_log;
CREATE POLICY tenant_isolation ON comms_delivery_log
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE comms_delivery_log FORCE ROW LEVEL SECURITY;
