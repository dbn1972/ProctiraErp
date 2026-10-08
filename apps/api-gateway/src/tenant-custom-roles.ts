/**
 * PRC-H101 — tenant custom roles feed gateway authorization.
 *
 * The admin console edits roles/permissions in `tenant.roles`
 * (PgRolesRepository). Before this change the gateway RBAC registry was built
 * once from static DEFAULT_ROLES + hardcoded extensions, so a token carrying a
 * tenant's custom role id was denied everywhere (the authorization path never
 * read the role store) — console edits had no effect.
 *
 * This provider loads a tenant's CUSTOM (non built-in) roles and merges them,
 * per request, into a registry derived from the immutable base registry. Built-in
 * role ids are never overridden by a tenant document (a custom row reusing a
 * built-in id is ignored), so a tenant cannot escalate `admin`/`platform_admin`.
 *
 * Results are cached per tenant with a short TTL and an explicit version bump so
 * a role edit (create/update/delete) takes effect across replicas within the TTL
 * and immediately on the replica that served the edit.
 */
import type { PermissionAction, RoleDefinition } from '@proctira/backend-auth';
import { DEFAULT_ROLES, RbacPermissionRegistry } from '@proctira/backend-auth';
import {
  createRolesRepository,
  type BuiltInRoleSeed,
  type RoleEntity,
  type RolesRepository,
} from '@proctira/backend-tenant';

/** CRUD/manage actions the RBAC evaluator understands. */
const RBAC_ACTIONS: ReadonlySet<string> = new Set([
  'create',
  'read',
  'update',
  'delete',
  'list',
  'manage',
  'preview',
]);

/** Default cache lifetime for a tenant's custom-role snapshot. */
const DEFAULT_TTL_MS = 30_000;

interface CacheEntry {
  roles: RoleDefinition[];
  expiresAt: number;
  version: number;
}

function toRoleDefinition(entity: RoleEntity): RoleDefinition {
  return {
    roleId: entity.roleId,
    roleName: entity.name,
    permissions: entity.permissions
      .filter((p) => RBAC_ACTIONS.has(p.action))
      .map((p) => ({ resource: p.resource, action: p.action as PermissionAction })),
  };
}

export interface TenantCustomRoleProviderOptions {
  repository: RolesRepository;
  /** Role ids that are immutable built-ins — never overridden by a tenant doc. */
  builtInRoleIds: ReadonlySet<string>;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Loads and caches a tenant's custom roles and merges them into a per-request
 * RBAC registry. Cross-replica freshness is bounded by the TTL; the replica that
 * served an edit invalidates immediately.
 */
export class TenantCustomRoleProvider {
  private readonly repository: RolesRepository;
  private readonly builtInRoleIds: ReadonlySet<string>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  /** Bumped on invalidate(tenantId) so an in-flight TTL entry is discarded. */
  private readonly versions = new Map<string, number>();
  /** Coalesces concurrent loads for the same tenant into one repository read. */
  private readonly inflight = new Map<string, Promise<RoleDefinition[]>>();

  constructor(options: TenantCustomRoleProviderOptions) {
    this.repository = options.repository;
    this.builtInRoleIds = options.builtInRoleIds;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  private versionOf(tenantId: string): number {
    return this.versions.get(tenantId) ?? 0;
  }

  /** Invalidate a tenant's cached custom roles (call on any role mutation). */
  invalidate(tenantId: string): void {
    this.versions.set(tenantId, this.versionOf(tenantId) + 1);
    this.cache.delete(tenantId);
    this.inflight.delete(tenantId);
  }

  /**
   * Custom (non built-in) roles for a tenant, from cache when fresh. On a
   * repository error the error propagates to the caller, which fails closed (no
   * custom grants merged) — a store outage cannot grant access, and built-in
   * roles still work.
   */
  async rolesFor(tenantId: string): Promise<RoleDefinition[]> {
    if (!tenantId) return [];
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > this.now() && cached.version === this.versionOf(tenantId)) {
      return cached.roles;
    }
    const existing = this.inflight.get(tenantId);
    if (existing) return existing;

    const versionAtLoad = this.versionOf(tenantId);
    const load = (async () => {
      try {
        const all = await this.repository.listRoles(tenantId);
        const custom = all
          .filter((r) => !r.builtIn && !this.builtInRoleIds.has(r.roleId))
          .map(toRoleDefinition);
        // Only cache if no invalidation happened during the load.
        if (this.versionOf(tenantId) === versionAtLoad) {
          this.cache.set(tenantId, {
            roles: custom,
            expiresAt: this.now() + this.ttlMs,
            version: versionAtLoad,
          });
        }
        return custom;
      } finally {
        this.inflight.delete(tenantId);
      }
    })();
    this.inflight.set(tenantId, load);
    return load;
  }

  /**
   * A registry for this request: the immutable base plus the tenant's custom
   * roles for any role id the caller carries that the base does not define.
   * Returns the base registry unchanged when the caller carries no such role,
   * so the common path pays no extra cost.
   */
  async registryForRequest(
    base: RbacPermissionRegistry,
    tenantId: string | undefined,
    callerRoleIds: readonly string[],
  ): Promise<RbacPermissionRegistry> {
    if (!tenantId || callerRoleIds.length === 0) return base;
    // Only when the caller holds a role id the base does not already define.
    const needsCustom = callerRoleIds.some(
      (id) => !this.builtInRoleIds.has(id) && !base.getRole(id),
    );
    if (!needsCustom) return base;

    const custom = await this.rolesFor(tenantId);
    if (custom.length === 0) return base;

    const merged = new RbacPermissionRegistry(base.getAllRoles());
    for (const role of custom) {
      // Never override a built-in role id (immutable).
      if (this.builtInRoleIds.has(role.roleId) || base.getRole(role.roleId)) continue;
      merged.registerRole(role);
    }
    return merged;
  }
}

/**
 * Built-in role seed (mirrors tenant-admin-plugin.builtInRoleSeed) so the roles
 * repository seeds the same per-tenant built-ins the console shows.
 */
function builtInRoleSeed(): BuiltInRoleSeed[] {
  return DEFAULT_ROLES.map((role) => ({
    roleId: role.roleId,
    roleName: role.roleName,
    permissions: role.permissions.filter((p): p is BuiltInRoleSeed['permissions'][number] =>
      ['create', 'read', 'update', 'delete', 'list', 'manage', 'preview', 'edit'].includes(
        p.action,
      ),
    ),
  }));
}

let sharedProvider: TenantCustomRoleProvider | null = null;

/**
 * Lazily-built process-wide provider shared by the gateway RBAC preHandler
 * (reader) and the tenant-admin plugin's role-audit hook (invalidator).
 *
 * `builtInRoleIds` is the set of role ids the base gateway registry already
 * defines; a tenant document reusing one of those ids is ignored so built-in
 * roles stay immutable.
 */
export function getTenantCustomRoleProvider(
  builtInRoleIds: ReadonlySet<string>,
): TenantCustomRoleProvider {
  if (!sharedProvider) {
    const { repository } = createRolesRepository(builtInRoleSeed());
    sharedProvider = new TenantCustomRoleProvider({ repository, builtInRoleIds });
  }
  return sharedProvider;
}

/** Invalidate a tenant's cached custom roles on the shared provider (if built). */
export function invalidateTenantCustomRoles(tenantId: string): void {
  sharedProvider?.invalidate(tenantId);
}

/** Test-only: reset the shared singleton. */
export function resetTenantCustomRoleProviderForTests(): void {
  sharedProvider = null;
}
