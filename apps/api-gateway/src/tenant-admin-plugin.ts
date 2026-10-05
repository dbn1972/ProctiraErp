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
import { AsyncLocalStorage } from 'node:async_hooks';

import { DEFAULT_ROLES, type PermissionAction } from '@proctira/backend-auth';
import {
  createRolesRepository,
  createTenantRepository,
  effectiveTenantSettings,
  InMemoryTenantSettingsStore,
  PgTenantSettingsStore,
  RolesAndSettingsSeeder,
  type TenantDefaultsSeeder,
  registerBrandingRoutes,
  registerRolesRoutes,
  registerTenantSettingsRoutes,
  RolesService,
  TenantService,
  type BuiltInRoleSeed,
  type RolesAuditEvent,
  type TenantSettingsStore,
} from '@proctira/backend-tenant';
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
  withPgTenant,
} from '@proctira/database';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createGatewayRbacRegistry, PLATFORM_ADMIN_ROLE_IDS } from './rbac-registry.js';
import { scimPlugin } from './scim-plugin.js';

const brandingRbacRegistry = createGatewayRbacRegistry();
const BRANDING_ACTIONS: Record<string, PermissionAction> = {
  'branding:preview': 'preview',
  'branding:edit': 'update',
};

/**
 * PRC-L208: undefined/blank → null (not supplied); a parseable https URL → its normalised
 * form; anything else (javascript:, data:, http:, garbage) → false (reject).
 */
function normaliseHttpsAssetUrl(value: string | undefined): string | null | false {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !url.hostname) return false;
    return url.toString();
  } catch {
    return false;
  }
}

/**
 * PRC-L004: branding permission check backed by the shared gateway RBAC registry.
 * Platform administrators (canonical {@link PLATFORM_ADMIN_ROLE_IDS}) are allowed, matching
 * the gateway's platform bypass; unknown permissions are denied.
 */
export function brandingPermissionGranted(user: unknown, permission: string): boolean {
  const action = BRANDING_ACTIONS[permission];
  if (!action) return false;
  const roles = (user as { roles?: unknown } | undefined)?.roles;
  if (!Array.isArray(roles)) return false;
  return roles.some((role: unknown) => {
    const roleId = typeof role === 'string' ? role : (role as { roleId?: unknown } | null)?.roleId;
    if (typeof roleId !== 'string') return false;
    if (PLATFORM_ADMIN_ROLE_IDS.has(roleId)) return true;
    return brandingRbacRegistry.roleHasPermission(roleId, 'branding', action);
  });
}

/** PRC-L205: roles/SCIM audit event enriched with the HTTP actor that caused it. */
export type TenantAdminAuditEvent = RolesAuditEvent & {
  /** JWT `sub` of the caller; null when no authenticated user (e.g. SCIM bearer). */
  actorId: string | null;
  /** Client IP as resolved by Fastify (`request.ip`); null outside a request. */
  ipAddress: string | null;
  requestId: string | null;
};

interface AuditActorContext {
  actorId: string | null;
  ipAddress: string | null;
  requestId: string | null;
}

const auditActorStore = new AsyncLocalStorage<AuditActorContext>();

export interface TenantAdminPluginOptions {
  /** Default `/tenant`; the gateway mounts `/api/v1` above. */
  prefix?: string;
  /** Receives every role/user mutation (wired to the audit service). */
  onAudit?: (event: TenantAdminAuditEvent) => Promise<void> | void;
  /** G-924: SCIM 2.0 base path; default `/scim/v2`. Set `false` to disable. */
  scimPrefix?: string | false;
  /** PRC-L003: shared tenant service; defaults to the `fastify.tenantService` decorator. */
  tenantService?: TenantService;
  /**
   * PRC-M466: when the audit sink rejects a high-risk role/user event, fail the
   * request with 503 instead of logging and returning success. Default `true`
   * (fail closed); set `false` only where an outbox guarantees delivery.
   */
  failOnAuditError?: boolean;
}

/** PRC-M466: surfaced (as 503) when a high-risk role/user audit write fails. */
export class TenantAdminAuditError extends Error {
  readonly statusCode = 503;
  readonly code = 'AUDIT_WRITE_FAILED';
  constructor(cause: unknown) {
    super('Audit trail write failed; the change was not acknowledged', { cause });
    this.name = 'TenantAdminAuditError';
  }
}

/** Built-in role seed derived from DEFAULT_ROLES (shared with tenant provisioning). */
export function builtInRoleSeed(): BuiltInRoleSeed[] {
  return DEFAULT_ROLES.map((role) => ({
    roleId: role.roleId,
    roleName: role.roleName,
    // The tenant package's PermissionRef vocabulary is the CRUD subset; other
    // actions (e.g. `preview`) are platform-only and not role-editable here.
    permissions: role.permissions.filter((p): p is BuiltInRoleSeed['permissions'][number] =>
      ['create', 'read', 'update', 'delete', 'list', 'manage', 'preview', 'edit'].includes(
        p.action,
      ),
    ),
  }));
}

/**
 * PRC-H099: roles/settings seeder for POST /tenant-lifecycle/tenants. Postgres
 * only — the same tables the tenant admin console reads. In-memory mode roles
 * seed lazily and settings fall back to defaults, so no seeder is needed.
 */
export function createTenantDefaultsSeederFromEnv(): TenantDefaultsSeeder | undefined {
  if (!process.env.DATABASE_URL?.trim()) return undefined;
  const pool = getSharedPgPool();
  if (!pool) return undefined;
  const { repository } = createRolesRepository(builtInRoleSeed());
  return new RolesAndSettingsSeeder(repository, new PgTenantSettingsStore(pool));
}

export const tenantAdminPlugin = fp(
  async (fastify: FastifyInstance, options: TenantAdminPluginOptions) => {
    const prefix = options.prefix ?? '/tenant';
    const seed = builtInRoleSeed();
    const { repository, persistence } = createRolesRepository(seed);
    // W1-SEC-12: settings store follows the same fail-closed policy as roles
    // (Pg when DATABASE_URL; never silent memory when Postgres is required).
    let settingsStore: TenantSettingsStore;
    if (process.env.DATABASE_URL?.trim()) {
      const pool = getSharedPgPool();
      assertPostgresRepositoryAvailable('tenant-settings', pool);
      settingsStore = new PgTenantSettingsStore(pool);
    } else {
      assertInMemoryFallbackAllowed('tenant-settings');
      settingsStore = new InMemoryTenantSettingsStore();
    }
    fastify.log.info({ persistence }, 'tenant admin console repository ready');

    // PRC-L205: RolesService emits audit events without request context, so bind the caller
    // (JWT sub, IP, request id) for the duration of each request handler.
    fastify.addHook('preHandler', (request, _reply, done) => {
      const sub = (request.user as { sub?: unknown } | undefined)?.sub;
      auditActorStore.run(
        {
          actorId: typeof sub === 'string' && sub ? sub : null,
          ipAddress: request.ip || null,
          requestId: request.id,
        },
        done,
      );
    });

    const rolesService = new RolesService(repository, async (event) => {
      if (!options.onAudit) return;
      const actor = auditActorStore.getStore();
      try {
        await options.onAudit({
          ...event,
          actorId: actor?.actorId ?? null,
          ipAddress: actor?.ipAddress ?? null,
          requestId: actor?.requestId ?? null,
        });
      } catch (error) {
        // PRC-M466: never silently drop a high-risk before/after record. Log for alerting and,
        // by default, fail the request so the caller does not see an unaudited success.
        fastify.log.error(
          {
            err: error,
            requestId: actor?.requestId ?? null,
            tenantId: event.tenantId,
            entityType: event.entityType,
            entityId: event.entityId,
            operation: event.operation,
            riskLevel: event.metadata.riskLevel,
          },
          'tenant admin audit write failed',
        );
        if (options.failOnAuditError !== false && event.metadata.riskLevel === 'high') {
          throw new TenantAdminAuditError(error);
        }
      }
    });

    await registerRolesRoutes(fastify, { rolesService, prefix });
    await registerTenantSettingsRoutes(fastify, {
      store: settingsStore,
      prefix,
      loadDirectory: async (tenantId) => {
        const pool = getSharedPgPool();
        if (!pool) return null;
        const result = await withPgTenant(pool, tenantId, (client) =>
          client.query('SELECT name, slug FROM tenants WHERE id = $1', [tenantId]),
        );
        const row = result.rows[0] as { name?: unknown; slug?: unknown } | undefined;
        const name = typeof row?.name === 'string' ? row.name.trim() : '';
        const slug = typeof row?.slug === 'string' ? row.slug.trim() : '';
        if (!name || !slug) return null;
        return { name, slug };
      },
    });

    // World-class branding (draft/publish/versions/active/preview)
    // PRC-L003: reuse the gateway's shared TenantService (tenantLifecyclePlugin decorator, backed
    // by app.ts getTenantRepository()) so branding writes and lifecycle reads see one store. A
    // private repository is only built when the plugin is mounted standalone.
    const tenantService =
      options.tenantService ??
      (fastify.hasDecorator('tenantService')
        ? fastify.tenantService
        : new TenantService(createTenantRepository().repository));
    await registerBrandingRoutes(fastify, {
      tenantService,
      prefix: `${prefix}/branding`,
      getTenantId: (request) =>
        (request as { tenantId?: string }).tenantId ??
        (request as { user?: { tenantId?: string } }).user?.tenantId,
      // PRC-L004: evaluate against the gateway RBAC registry with resource `branding` and the
      // exact action (preview → preview, edit → update). No role-name lists or cross-resource
      // fallbacks (user:manage / tenant:update no longer imply branding rights).
      hasPermission: (request, permission) =>
        Promise.resolve(brandingPermissionGranted(request.user, permission)),
    });

    // Logo/favicon asset staging onto tenant settings branding.
    // PRC-L208: https URLs only (no javascript:/data:/http:), branding:edit required, and both
    // logoUrl and faviconUrl are persisted (faviconUrl used to be echoed but dropped).
    const httpsAssetUrl = {
      type: 'string',
      minLength: 9,
      maxLength: 2048,
      pattern: '^https://\\S+$',
    };
    fastify.post<{ Body: { logoUrl?: string; faviconUrl?: string } }>(
      `${prefix}/branding/assets`,
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            properties: { logoUrl: httpsAssetUrl, faviconUrl: httpsAssetUrl },
          },
        },
      },
      async (request, reply) => {
        const tenantId =
          (request as { tenantId?: string }).tenantId ??
          (request as { user?: { tenantId?: string } }).user?.tenantId;
        if (!tenantId) {
          return reply
            .code(400)
            .send({ statusCode: 400, error: 'Bad Request', message: 'tenant required' });
        }
        if (!brandingPermissionGranted(request.user, 'branding:edit')) {
          return reply.code(403).send({
            statusCode: 403,
            code: 'FORBIDDEN',
            message: "Missing required permission 'branding:edit'",
          });
        }
        const logoUrl = normaliseHttpsAssetUrl(request.body?.logoUrl);
        const faviconUrl = normaliseHttpsAssetUrl(request.body?.faviconUrl);
        if (logoUrl === false || faviconUrl === false) {
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'logoUrl and faviconUrl must be absolute https URLs',
          });
        }
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
        const sub = (request.user as { sub?: unknown } | undefined)?.sub;
        const next = {
          ...base,
          tenantId,
          updatedAt: new Date().toISOString(),
          updatedBy: typeof sub === 'string' ? sub : null,
          branding: {
            ...base.branding,
            ...(logoUrl ? { logoUrl } : {}),
            ...(faviconUrl ? { faviconUrl } : {}),
          },
        };
        await settingsStore.put(next);
        return reply.code(200).send({ tenantId, branding: next.branding });
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
