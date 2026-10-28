/**
 * Data-warehouse in-package authentication, tenant binding and RBAC (PRC-M617).
 *
 * The package is parked (not mounted by the gateway, topic 15), so nothing in
 * front of these routes resolves a tenant or checks a role. This guard makes the
 * routes fail closed on their own:
 * - a verified principal (`request.user.sub`) is required (401 otherwise);
 * - the tenant comes from the principal's tenant claim, never from a value the
 *   request supplied; a resolved `request.tenantId` that differs is refused (403);
 * - reads (GET, POST …/query) need a data/admin role, every other method needs a
 *   data-admin/admin role (403 otherwise).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
const ADMIN_ROLES = [
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
] as const;
const WRITE_ROLES = new Set<string>([...ADMIN_ROLES, 'data_admin', 'data-admin']);
const READ_ROLES = new Set<string>([
  ...WRITE_ROLES,
  'data_engineer',
  'data-engineer',
  'data_analyst',
  'data-analyst',
]);
export type DataWarehouseAccess = 'read' | 'write';
export function normalizeWarehouseRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (typeof role === 'string') return role.toLowerCase();
      if (role && typeof role === 'object') {
        const obj = role as Record<string, unknown>;
        const raw = obj['roleId'] ?? obj['roleName'] ?? obj['id'] ?? '';
        return typeof raw === 'string' ? raw.toLowerCase() : '';
      }
      return '';
    })
    .filter(Boolean);
}
export function hasWarehouseAccess(roles: unknown, access: DataWarehouseAccess): boolean {
  const allowed = access === 'write' ? WRITE_ROLES : READ_ROLES;
  return normalizeWarehouseRoles(roles).some((role) => allowed.has(role));
}
/** GET and the read-only POST …/query are reads; everything else mutates. */
export function warehouseAccessFor(method: string, url: string): DataWarehouseAccess {
  const path = url.split('?')[0] ?? '';
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (method === 'POST' && path.endsWith('/query')) return 'read';
  return 'write';
}
type PrincipalRequest = FastifyRequest & {
  tenantId?: string;
  user?: { sub?: unknown; tenantId?: unknown; roles?: unknown };
};
/**
 * preHandler: returns true when the request may proceed (and binds
 * `request.tenantId` to the token tenant); otherwise sends 401/403.
 */
export function enforceDataWarehouseAccess(request: FastifyRequest, reply: FastifyReply): boolean {
  const req = request as PrincipalRequest;
  const sub = typeof req.user?.sub === 'string' ? req.user.sub.trim() : '';
  if (!sub) {
    void reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authenticated user required',
      statusCode: 401,
    });
    return false;
  }
  const tokenTenant = typeof req.user?.tenantId === 'string' ? req.user.tenantId.trim() : '';
  if (!tokenTenant) {
    void reply.status(403).send({
      code: 'TENANT_REQUIRED',
      message: 'A verified tenant claim is required',
      statusCode: 403,
    });
    return false;
  }
  if (req.tenantId !== undefined && req.tenantId !== tokenTenant) {
    void reply.status(403).send({
      code: 'TENANT_MISMATCH',
      message: 'Request tenant does not match the authenticated tenant',
      statusCode: 403,
    });
    return false;
  }
  if (!hasWarehouseAccess(req.user?.roles, warehouseAccessFor(request.method, request.url))) {
    void reply.status(403).send({
      code: 'FORBIDDEN',
      message: 'Data-warehouse access requires a data or admin role',
      statusCode: 403,
    });
    return false;
  }
  req.tenantId = tokenTenant;
  return true;
}
