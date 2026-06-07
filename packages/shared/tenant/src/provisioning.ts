/**
 * Tenant Provisioning Module
 *
 * Handles the creation of new tenants including:
 * - Creating the Tenant record
 * - Seeding default area hierarchy (root node)
 * - Creating the initial admin user with full permissions
 *
 * Provisioning operations bypass RLS by using a direct database connection
 * (superuser or service role) since the tenant doesn't exist yet when provisioning starts.
 */

import { createLogger } from '@proctira/logging';

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

  const result = await db.$transaction(async (tx) => {
    // Step 1: Create the Tenant record
    const tenantConfig = JSON.stringify(input.config ?? {});
    const tenantRows = await tx.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      slug: string;
      status: string;
      created_at: Date;
    }>>(
      `INSERT INTO tenants (name, slug, config, status, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'active', NOW(), NOW())
       RETURNING id, name, slug, status, created_at`,
      input.name,
      input.slug,
      tenantConfig,
    );

    const tenant = tenantRows[0];
    if (!tenant) {
      throw new Error('Failed to create tenant record');
    }

    logger.info({ tenantId: tenant.id, slug: tenant.slug }, 'Tenant record created');

    // Step 2: Seed default root area hierarchy node
    const areaRows = await tx.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      code: string;
    }>>(
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

    // Step 3: Create admin user
    // Note: The users table may not exist yet in the current schema iteration.
    // We create a minimal admin record that the auth service can use.
    const adminRows = await tx.$queryRawUnsafe<Array<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
    }>>(
      `INSERT INTO users (tenant_id, email, first_name, last_name, password_hash, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'admin', 'active', NOW(), NOW())
       RETURNING id, email, first_name, last_name`,
      tenant.id,
      input.admin.email,
      input.admin.firstName,
      input.admin.lastName,
      input.admin.passwordHash,
    );

    const adminUser = adminRows[0];
    if (!adminUser) {
      throw new Error('Failed to create admin user');
    }

    logger.info(
      { tenantId: tenant.id, adminEmail: adminUser.email },
      'Admin user created',
    );

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
      adminUser: {
        id: adminUser.id,
        email: adminUser.email,
        firstName: adminUser.first_name,
        lastName: adminUser.last_name,
      },
    };
  });

  logger.info(
    { tenantId: result.tenant.id, slug: result.tenant.slug },
    'Tenant provisioning completed successfully',
  );

  return result;
}
