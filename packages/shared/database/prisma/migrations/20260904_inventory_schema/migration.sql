-- Phase 22: Inventory
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS inventory.items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  institution_id UUID,
  sku VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(255) NOT NULL DEFAULT 'ea',
  quantity_on_hand DOUBLE PRECISION NOT NULL DEFAULT 0,
  reorder_level DOUBLE PRECISION NOT NULL DEFAULT 0,
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS items_tenant_id_idx ON inventory.items (tenant_id);

CREATE TABLE IF NOT EXISTS inventory.stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL,
  movement_type VARCHAR(255) NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  issued_to_staff_id UUID,
  notes TEXT,
  moved_at VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_movements_tenant_id_idx ON inventory.stock_movements (tenant_id);

