-- Phase schema ownership: notification (charter §19)
-- CREATE SCHEMA + tables; bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS notification;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS notification.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  channel VARCHAR(30) NOT NULL,
  template_id UUID NOT NULL,
  recipient_user_id UUID NOT NULL,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 3,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  webhook_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_tenant_id_recipient_user_id_status_idx ON notification.notifications (tenant_id, recipient_user_id, status);

CREATE TABLE IF NOT EXISTS notification.notification_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  event VARCHAR(100) NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id UUID NOT NULL,
  channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipient_query JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  schedule VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_rules_tenant_id_entity_type_is_active_idx ON notification.notification_rules (tenant_id, entity_type, is_active);

CREATE TABLE IF NOT EXISTS notification.notification_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  subject VARCHAR(500),
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_templates_tenant_id_channel_idx ON notification.notification_templates (tenant_id, channel);

