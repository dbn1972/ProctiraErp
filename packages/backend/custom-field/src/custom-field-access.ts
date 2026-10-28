/**
 * Custom-field in-package authentication, tenant binding and RBAC (PRC-L446).
 *
 * The package is parked (not mounted by the gateway, topic 15), so these
 * routes had no authorization of their own while reading and writing values
 * attached to student and staff records. This guard fails closed:
 * - a verified principal (`request.user.sub`) is required (401);
 * - the principal's tenant claim must equal the resolved request tenant (403);
 * - definitions: reads for any role allowed on some entity, writes admin-only;
 * - values: per entity type, only the roles that own those records
 *   (student: registrar/admissions; staff: HR; institution: admins).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { CustomFieldEntityType } from './custom-field-repository.js';
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
const STUDENT_RECORD_ROLES = [...ADMIN_ROLES, 'registrar', 'admissions_officer'] as const;
const STAFF_RECORD_ROLES = [...ADMIN_ROLES, 'hr_officer', 'staff_admin'] as const;
const VALUE_ROLES: Record<CustomFieldEntityType, ReadonlySet<string>> = {
  student: new Set<string>(STUDENT_RECORD_ROLES),
  staff: new Set<string>(STAFF_RECORD_ROLES),
  institution: new Set<string>(ADMIN_ROLES),
};
const DEFINITION_WRITE_ROLES = new Set<string>(ADMIN_ROLES);
const DEFINITION_READ_ROLES = new Set<string>([...STUDENT_RECORD_ROLES, ...STAFF_RECORD_ROLES]);
export function normalizeCustomFieldRoles(roles: unknown): string[] {
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
function allowedRolesFor(request: FastifyRequest): ReadonlySet<string> | null {
  const path = request.url.split('?')[0] ?? '';
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  if (path.includes('/definitions')) {
    return isRead ? DEFINITION_READ_ROLES : DEFINITION_WRITE_ROLES;
  }
  const entityType = (request.params as { entityType?: unknown } | undefined)?.entityType;
  if (typeof entityType === 'string' && entityType in VALUE_ROLES) {
    return VALUE_ROLES[entityType as CustomFieldEntityType];
  }
  // Unknown entity types get no role: the route's own params validation would
  // reject them anyway, but authorization never defaults open.
  return null;
}
type PrincipalRequest = FastifyRequest & {
  tenantId?: string;
  user?: { sub?: unknown; tenantId?: unknown; roles?: unknown };
};
/** preHandler body: true when the request may proceed; otherwise sends 401/403. */
export function enforceCustomFieldAccess(request: FastifyRequest, reply: FastifyReply): boolean {
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
  if (!tokenTenant || (req.tenantId !== undefined && req.tenantId !== tokenTenant)) {
    void reply.status(403).send({
      code: 'TENANT_MISMATCH',
      message: 'Request tenant does not match the authenticated tenant',
      statusCode: 403,
    });
    return false;
  }
  const allowed = allowedRolesFor(request);
  const roles = normalizeCustomFieldRoles(req.user?.roles);
  if (!allowed || !roles.some((role) => allowed.has(role))) {
    void reply.status(403).send({
      code: 'FORBIDDEN',
      message: 'Your role may not access these custom fields',
      statusCode: 403,
    });
    return false;
  }
  req.tenantId = tokenTenant;
  return true;
}
