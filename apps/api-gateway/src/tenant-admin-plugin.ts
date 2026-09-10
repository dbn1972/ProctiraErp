/**
 * Tenant admin console (G-910) — `/api/v1/tenant/*`.
 *
 * Mounts the tenant-scoped Roles & Permissions routes that already existed in
 * `@proctira/backend-tenant` (they were never registered on the gateway) plus
 * tenant settings, backed by Postgres (`control_plane_documents`) when
 * DATABASE_URL is set. The web `/admin/{users,roles,permissions,tenant}` pages
 * consume these.
 *
 * RBAC: `tenant` → `user` resource, so tenant administrators (`user: manage`)
 * can manage their own school/board without platform-admin rights. Every
 * mutation is written to the audit log with `riskLevel: 'high'`.
 *
 * Routes:
 *   GET    /tenant/roles                     GET  /tenant/permissions
 *   POST   /tenant/roles                     GET/PATCH/DELETE /tenant/roles/:id
 *   PATCH  /tenant/roles/:id/permissions
 *   GET    /tenant/users                     POST /tenant/users (invite)
 *   PATCH  /tenant/users/:userId/roles       PATCH /tenant/users/:userId/status
 *   GET/PUT /tenant/settings
 *
 * G-924: the same RolesService also backs SCIM 2.0 provisioning at
 * `/scim/v2/{Users,Groups}` (see scim-plugin.ts) so IdP pushes are audited
 * exactly like console edits.
 */
import { DEFAULT_ROLES } from '@proctira/backend-auth';
import {
  createRolesRepository,
  InMemoryTenantSettingsStore,
  PgTenantSettingsStore,
  registerRolesRoutes,
  registerTenantSettingsRoutes,
  RolesService,
  type BuiltInRoleSeed,
  type RolesAuditEvent,
  type TenantSettingsStore,
} from '@proctira/backend-tenant';
import { getSharedPgPool } from '@proctira/database';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { scimPlugin } from './scim-plugin.js';

export interface TenantAdminPluginOptions {
  /** Default `/tenant`; the gateway mounts `/api/v1` above. */
  prefix?: string;
  /** Receives every role/user mutation (wired to the audit service). */
  onAudit?: (event: RolesAuditEvent & { actorId: string | null }) => Promise<void> | void;
  /** G-924: SCIM 2.0 base path; default `/scim/v2`. Set `false` to disable. */
  scimPrefix?: string | false;
}

export const tenantAdminPlugin = fp(
  async (fastify: FastifyInstance, options: TenantAdminPluginOptions) => {
    const prefix = options.prefix ?? '/tenant';
    const seed: BuiltInRoleSeed[] = DEFAULT_ROLES.map((role) => ({
      roleId: role.roleId,
      roleName: role.roleName,
      // The tenant package's PermissionRef vocabulary is the CRUD subset; other
      // actions (e.g. `preview`) are platform-only and not role-editable here.
      permissions: role.permissions.filter((p): p is BuiltInRoleSeed['permissions'][number] =>
        ['create', 'read', 'update', 'delete', 'list', 'manage'].includes(p.action),
      ),
    }));
    const { repository, persistence } = createRolesRepository(seed);
    const pool = getSharedPgPool();
    const settingsStore: TenantSettingsStore = pool
      ? new PgTenantSettingsStore(pool)
      : new InMemoryTenantSettingsStore();
    fastify.log.info({ persistence }, 'tenant admin console repository ready');

    const rolesService = new RolesService(repository, async (event) => {
      if (!options.onAudit) return;
      try {
        await options.onAudit({ ...event, actorId: null });
      } catch {
        // Audit must not break the primary request path.
      }
    });

    await registerRolesRoutes(fastify, { rolesService, prefix });
    await registerTenantSettingsRoutes(fastify, { store: settingsStore, prefix });
    if (options.scimPrefix !== false) {
      await fastify.register(scimPlugin, {
        rolesService,
        prefix: options.scimPrefix ?? '/scim/v2',
      });
    }
  },
  { name: 'tenant-admin-plugin' },
);
