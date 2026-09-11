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
  createTenantRepository,
  effectiveTenantSettings,
  InMemoryTenantSettingsStore,
  PgTenantSettingsStore,
  registerBrandingRoutes,
  registerRolesRoutes,
  registerTenantSettingsRoutes,
  RolesService,
  TenantService,
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
        ['create', 'read', 'update', 'delete', 'list', 'manage', 'preview', 'edit'].includes(p.action),
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

    // World-class branding (draft/publish/versions/active/preview)
    const { repository: tenantRepo } = createTenantRepository();
    const tenantService = new TenantService(tenantRepo);
    await registerBrandingRoutes(fastify, {
      tenantService,
      prefix: `${prefix}/branding`,
      getTenantId: (request) =>
        (request as { tenantId?: string }).tenantId ??
        (request as { user?: { tenantId?: string } }).user?.tenantId,
      hasPermission: async (request, permission) => {
        const user = (request as { user?: { roles?: Array<string | { roleId?: string; permissions?: Array<{ resource: string; action: string }> }> } }).user;
        if (!user) return false;
        const roles = user.roles ?? [];
        // Tenant admins with user:manage (or branding:* / tenant manage) may brand.
        for (const role of roles) {
          const id = typeof role === 'string' ? role : role.roleId;
          if (id && ['tenant_admin', 'platform_admin', 'super_admin', 'admin'].includes(id)) {
            return true;
          }
          if (typeof role !== 'string' && Array.isArray(role.permissions)) {
            if (
              role.permissions.some(
                (p) =>
                  (p.resource === 'branding' && (p.action === permission.split(':')[1] || p.action === 'manage')) ||
                  (p.resource === 'tenant' && (p.action === 'manage' || p.action === 'update')) ||
                  (p.resource === 'user' && p.action === 'manage'),
              )
            ) {
              return true;
            }
          }
        }
        return false; // published branding is public via GET; draft preview requires branding:preview
      },
    });

    // Logo asset staging (URL/data-URI already validated on publish; this stores a draft logo URL helper)
    fastify.post<{ Body: { logoUrl?: string; faviconUrl?: string } }>(
      `${prefix}/branding/assets`,
      async (request, reply) => {
        const tenantId =
          (request as { tenantId?: string }).tenantId ??
          (request as { user?: { tenantId?: string } }).user?.tenantId;
        if (!tenantId) {
          return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'tenant required' });
        }
        const logoUrl = request.body?.logoUrl?.trim() || null;
        const faviconUrl = request.body?.faviconUrl?.trim() || null;
        if (!logoUrl && !faviconUrl) {
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'logoUrl or faviconUrl required',
          });
        }
        // Persist onto settings branding for immediate admin console use.
        const current = await settingsStore.get(tenantId);
        const base = effectiveTenantSettings(tenantId, current);
        const next = {
          ...base,
          tenantId,
          updatedAt: new Date().toISOString(),
          updatedBy: (request as { user?: { id?: string } }).user?.id ?? null,
          branding: {
            ...base.branding,
            ...(logoUrl ? { logoUrl } : {}),
          },
        };
        await settingsStore.put(next);
        return reply.code(200).send({ tenantId, branding: next.branding, faviconUrl });
      },
    );

    if (options.scimPrefix !== false) {
      await fastify.register(scimPlugin, {
        rolesService,
        prefix: options.scimPrefix ?? '/scim/v2',
      });
    }
  },
  { name: 'tenant-admin-plugin' },
);
