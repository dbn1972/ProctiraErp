-- Phase 23: Canteen / MDM
CREATE SCHEMA IF NOT EXISTS canteen;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS canteen.meal_menus (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  date VARCHAR(255) NOT NULL,
  meal_type VARCHAR(255) NOT NULL DEFAULT 'lunch',
  items TEXT NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS meal_menus_tenant_id_idx ON canteen.meal_menus (tenant_id);

CREATE TABLE IF NOT EXISTS canteen.meal_servings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  menu_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  served_count DOUBLE PRECISION NOT NULL,
  wastage_count DOUBLE PRECISION NOT NULL DEFAULT 0,
  served_at VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS meal_servings_tenant_id_idx ON canteen.meal_servings (tenant_id);

