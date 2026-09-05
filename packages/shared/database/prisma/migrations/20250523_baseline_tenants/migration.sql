-- Baseline: tenants table
--
-- Incremental migrations (theme versions, drafts, attendance, examinations)
-- all FK to tenants(id). Historically the core schema lived outside this
-- migration history; fresh CI Postgres has an empty database, so migrate
-- deploy fails with 42P01 / relation "tenants" does not exist.
--
-- CREATE TABLE IF NOT EXISTS keeps this safe on environments that already
-- have tenants from an older bootstrap / db push.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS "tenants" (
    "id"         UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "name"       VARCHAR(255) NOT NULL,
    "slug"       VARCHAR(100) NOT NULL,
    "config"     JSONB                 DEFAULT '{}',
    "status"     VARCHAR(20)  NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP    NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP    NOT NULL DEFAULT NOW(),
    "deleted_at" TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key"
    ON "tenants" ("slug");
