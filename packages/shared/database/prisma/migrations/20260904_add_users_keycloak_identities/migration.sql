-- Phase 2: platform users + Keycloak identity links.
-- Keycloak remains the password and role authority.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE "users" (
    "id"           UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"    UUID         NOT NULL,
    "email"        VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "first_name"   VARCHAR(100) NOT NULL,
    "last_name"    VARCHAR(100) NOT NULL,
    "status"       VARCHAR(20)  NOT NULL DEFAULT 'active',
    "country_code" VARCHAR(2)   NOT NULL DEFAULT 'IN',
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_tenant_email_key" UNIQUE ("tenant_id", "email"),
    CONSTRAINT "users_tenant_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "users_tenant_status_idx" ON "users" ("tenant_id", "status");

CREATE TABLE "user_identities" (
    "id"           UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "user_id"      UUID         NOT NULL,
    "tenant_id"    UUID         NOT NULL,
    "provider"     VARCHAR(50)  NOT NULL,
    "external_id"  VARCHAR(255) NOT NULL,
    "email"        VARCHAR(255) NOT NULL,
    "realm"        VARCHAR(100) NOT NULL DEFAULT 'proctira',
    "last_used_at" TIMESTAMPTZ,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_identities_provider_external_key" UNIQUE ("provider", "external_id"),
    CONSTRAINT "user_identities_user_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "user_identities_tenant_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "user_identities_tenant_email_idx" ON "user_identities" ("tenant_id", "email");

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON "users"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON "users"
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_update ON "users"
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON "users"
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE "user_identities" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON "user_identities"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON "user_identities"
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_update ON "user_identities"
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON "user_identities"
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
