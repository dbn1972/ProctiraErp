/**
 * Tenant Provisioning Module
 *
 * Handles the creation of new tenants including:
 * - Creating the Tenant record
 * - Seeding default area hierarchy (root node)
 * - Creating the initial admin user with full permissions
 *
 * `tenants` is FORCE-RLS (db/sql/021 + Prisma 20260908_wave7_rls_hardening), so
 * even the owning app role cannot insert a tenant row without control-plane
 * scope. Provisioning therefore binds `app.platform_admin = '1'` transaction-
 * locally for the tenant insert, then binds the freshly minted tenant id
 * (canonical `app.tenant_id`, legacy alias synced) before seeding tenant-scoped rows.
 */

import { bindTenantGucPrisma } from '@proctira/database';
import { createLogger } from '@proctira/logging';

import { resolveTenantTimezoneDetailed } from './tenant-timezone.js';

const logger = createLogger({ name: 'tenant-provisioning' });

/**
 * Input data for provisioning a new tenant.
 */
export interface ProvisionTenantInput {
  /** Display name of the tenant organization */
  name: string;
  /** URL-safe slug for subdomain routing (e.g., 'ministry-edu') */
  slug: string;
  /** Optional tenant configuration overrides */
  config?: Record<string, unknown>;
  /** Admin user details */
  admin: {
    firstName: string;
    lastName: string;
    email: string;
    /** Pre-hashed password (caller is responsible for hashing) */
    passwordHash: string;
  };
}

/**
 * Result of a successful tenant provisioning operation.
 */
export interface ProvisionTenantResult {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: Date;
  };
  rootArea: {
    id: string;
    name: string;
    code: string;
  };
  adminUser: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

/**
 * Database client interface for provisioning operations.
 * This is a minimal interface that works with PrismaClient or any compatible client.
 */
export interface ProvisioningDbClient {
  $transaction: <T>(fn: (tx: ProvisioningTxClient) => Promise<T>) => Promise<T>;
}

/**
 * Transaction client interface used within provisioning.
 */
export interface ProvisioningTxClient {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
}

/**
 * Provisions a new tenant with all required seed data.
 *
 * This function:
 * 1. Creates the Tenant record in the tenants table
 * 2. Seeds a root geographic area node for the tenant's area hierarchy
 * 3. Creates an admin user with full permissions
 *
 * All operations run within a single database transaction.
 * If any step fails, the entire provisioning is rolled back.
 *
 * @param db - Database client (should have superuser/service role access to bypass RLS)
 * @param input - Tenant provisioning data
 * @returns The created tenant, root area, and admin user
 */
export async function provisionTenant(
  db: ProvisioningDbClient,
  input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
  logger.info({ slug: input.slug, name: input.name }, 'Starting tenant provisioning');

  // PRC-L496: this function is NOT a usable provisioning path. It inserted into a
  // non-existent `users` table (password_hash/role) and had no production caller —
  // identity is owned by Keycloak and tenant-admin onboarding runs through the
  // backend `provisionTenantAdmin` flow (packages/backend/tenant). Rather than
  // leave a half-built path that fails deep inside a transaction (undefined
  // relation) and implies a credential store that does not exist, fail closed
  // immediately with a clear pointer to the correct flow.
  void db;
  void input;
  await Promise.resolve();
  throw new Error(
    'provisionTenant is not implemented: there is no `users` table and identity is managed by ' +
      'Keycloak. Create tenants via the backend tenant service (provisionTenantAdmin), which ' +
      'provisions the Keycloak admin and emits the audit event (PRC-L496).',
  );
}

/**
 * Legacy reference implementation retained for the eventual Keycloak-backed
 * rewrite. Not exported and not called — kept so the SQL shape for the tenant +
 * root-area inserts is not lost. Do NOT wire this up without replacing the admin
 * step with Keycloak + a real identity schema and adding platform-admin authz +
 * an audit event (PRC-L496).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function provisionTenantLegacyReference(
  db: ProvisioningDbClient,
  input: ProvisionTenantInput,
): Promise<Omit<ProvisionTenantResult, 'adminUser'>> {
  const result = await db.$transaction(async (tx) => {
    // Control-plane scope for the tenants insert (transaction-local; is_local=true).
    await tx.$executeRawUnsafe(`SELECT set_config('app.platform_admin', '1', true)`);

    // Step 1: Create the Tenant record
    const tenantConfig = input.config ?? {};
    const tz = resolveTenantTimezoneDetailed({ config: tenantConfig });
    if (tz.fellBack && tz.rejected.length > 0) {
      // PRC-L358: reject an explicitly configured but invalid zone instead of silently using UTC.
      throw new Error(`Invalid tenant timezone: ${JSON.stringify(tz.rejected[0])}`);
    }
    if (tz.fellBack) {
      logger.warn(
        { slug: input.slug, timezone: tz.timezone },
        'No tenant timezone configured; defaulting to UTC',
      );
    }
    const timezone = tz.timezone;
    const tenantRows = await tx.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        slug: string;
        status: string;
        created_at: Date;
      }>
    >(
      `INSERT INTO tenants (name, slug, config, timezone, status, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, 'active', NOW(), NOW())
       RETURNING id, name, slug, status, created_at`,
      input.name,
      input.slug,
      JSON.stringify(tenantConfig),
      timezone,
    );

    const tenant = tenantRows[0];
    if (!tenant) {
      throw new Error('Failed to create tenant record');
    }

    logger.info({ tenantId: tenant.id, slug: tenant.slug }, 'Tenant record created');

    // W1-DATA-12: bind canonical app.tenant_id (+ legacy alias) for seeded rows.
    await bindTenantGucPrisma(tx, tenant.id);

    // Step 2: Seed default root area hierarchy node
    const areaRows = await tx.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        code: string;
      }>
    >(
      `INSERT INTO geographic_areas (tenant_id, name, code, level, parent_id, path, lft, rgt, created_at, updated_at)
       VALUES ($1, $2, $3, 0, NULL, '/', 1, 2, NOW(), NOW())
       RETURNING id, name, code`,
      tenant.id,
      `${input.name} - Root Area`,
      'ROOT',
    );

    const rootArea = areaRows[0];
    if (!rootArea) {
      throw new Error('Failed to create root area');
    }

    logger.info({ tenantId: tenant.id, areaId: rootArea.id }, 'Root area created');

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        createdAt: tenant.created_at,
      },
      rootArea: {
        id: rootArea.id,
        name: rootArea.name,
        code: rootArea.code,
      },
    };
  });

  logger.info(
    { tenantId: result.tenant.id, slug: result.tenant.slug },
    'Tenant provisioning completed successfully',
  );

  return result;
}
