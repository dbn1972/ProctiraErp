/**
 * W1-SEC-02 — exact mutating-route authorization inventory + enforce helper.
 *
 * Coarse URL-segment / HTTP-method mapping in `rbac-registry.ts` remains as a
 * defense-in-depth layer for reads (and as the seed for inventory actions).
 * Plugin-wide domain hooks (e.g. examination `document.generate`) also remain.
 *
 * Mutating `/api/v1/*` requests must resolve an **inventory-declared**
 * `{ resource, action }` guard. Missing inventory coverage fails closed.
 *
 * Deferred plugins still appear in the inventory (coarse resource + method
 * action) but lack package-level domain action helpers; the coverage test
 * fails when new registered mutating routes are not covered by this inventory.
 */

import type { PermissionAction } from '@proctira/backend-auth';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteOptions,
} from 'fastify';

import {
  actionForMethod,
  GATEWAY_UTILITY_SEGMENTS,
  PATH_RESOURCE_MAP,
  PLATFORM_ADMIN_ROLE_IDS,
  resourceForApiPath,
  UNMAPPED_API_RESOURCE,
} from './rbac-registry.js';

export const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ExactMutatingAuthzGuard {
  /** Gateway RBAC resource (registry key). */
  resource: string;
  /** Gateway RBAC action. */
  action: PermissionAction;
  /**
   * Optional domain-level action label (documentation / package guards).
   * Not evaluated by the gateway registry — package hooks enforce these.
   */
  domainAction?: string;
  /** Inventory rule id that produced this guard. */
  ruleId: string;
  /** When true, package-level exact domain guards are still residual. */
  deferredDomainGuard: boolean;
}

/**
 * Prefix / path rules that **declare** exact resource/action for mutating routes.
 * More specific `pathPrefix` wins. `methods` defaults to all mutating verbs.
 */
export interface MutatingAuthzInventoryRule {
  /** Stable id for tests / audits. */
  id: string;
  /**
   * Path prefix under the gateway (must start with `/api/v1/`).
   * Matching is case-sensitive path-prefix on the request path (query stripped).
   */
  pathPrefix: string;
  resource: string;
  /**
   * Fixed action for all methods in this rule. When omitted, `actionForMethod`
   * is used — still an explicit inventory declaration, not ad-hoc inference
   * at the call site.
   */
  action?: PermissionAction;
  /** Restrict to these methods (uppercase). Default: all mutating. */
  methods?: ReadonlyArray<'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
  /** Optional domain action annotation. */
  domainAction?: string;
  /**
   * Package still lacks fine domain `*-access` HTTP guards; inventory +
   * gateway exact resource/action still required. New routes under these
   * prefixes must be added here or the coverage test fails.
   */
  deferredDomainGuard?: boolean;
}

/**
 * Packages that already ship package-level domain action guards
 * (`*-access` + HTTP guard). Everything else mounted under PATH_RESOURCE_MAP
 * is treated as deferred for domain-action depth.
 */
const DOMAIN_GUARD_COMPLETE_RESOURCES = new Set([
  'examination',
  'fees',
  'scholarship',
  'hostel',
  'staff',
  'student',
  'billing',
  'health',
  'gradebook',
  'timetable',
  'transport',
  'library',
  'registration',
  'notification',
  'communication',
  'lms',
  'attendance',
]);

function deferredForResource(resource: string): boolean {
  if (resource === 'platform' || resource === 'user') return false;
  return !DOMAIN_GUARD_COMPLETE_RESOURCES.has(resource);
}

/**
 * Build default inventory declarations from PATH_RESOURCE_MAP so every mapped
 * prefix has an explicit mutating guard without rewriting every route file.
 * Specific overrides below win via longer prefix / earlier sort.
 */
function buildSegmentRules(): MutatingAuthzInventoryRule[] {
  return Object.entries(PATH_RESOURCE_MAP).map(([segment, resource]) => ({
    id: `segment:${segment}`,
    pathPrefix: `/api/v1/${segment}`,
    resource,
    deferredDomainGuard: deferredForResource(resource),
  }));
}

/**
 * Route-specific exact declarations (longer prefixes / domain annotations).
 * These override segment defaults when the path is more specific.
 */
export const MUTATING_AUTHZ_EXACT_OVERRIDES: readonly MutatingAuthzInventoryRule[] = [
  {
    id: 'examination.documents.generate',
    pathPrefix: '/api/v1/examinations',
    resource: 'examination',
    action: 'create',
    methods: ['POST'],
    domainAction: 'document.generate',
    deferredDomainGuard: false,
  },
  {
    id: 'fees.payments',
    pathPrefix: '/api/v1/fees/payments',
    resource: 'fees',
    action: 'create',
    methods: ['POST'],
    domainAction: 'payment.record',
    deferredDomainGuard: false,
  },
  {
    id: 'fees.concessions',
    pathPrefix: '/api/v1/fees/concessions',
    resource: 'fees',
    action: 'create',
    methods: ['POST'],
    domainAction: 'concession.apply',
    deferredDomainGuard: false,
  },
  {
    id: 'hostel.leaves',
    pathPrefix: '/api/v1/hostel/leaves',
    resource: 'hostel',
    action: 'create',
    methods: ['POST'],
    domainAction: 'leave.manage',
    deferredDomainGuard: false,
  },
  {
    id: 'scholarship.programs',
    pathPrefix: '/api/v1/scholarships/programs',
    resource: 'scholarship',
    deferredDomainGuard: false,
  },
  // Deferred campus domains — explicit inventory rows (coarse resource/action).
  {
    id: 'transport.vehicles',
    pathPrefix: '/api/v1/transport',
    resource: 'transport',
    deferredDomainGuard: false,
  },
  {
    id: 'library.circulation',
    pathPrefix: '/api/v1/library',
    resource: 'library',
    deferredDomainGuard: false,
  },
  {
    id: 'registration.staff',
    pathPrefix: '/api/v1/registrations',
    resource: 'registration',
    deferredDomainGuard: false,
  },
  {
    id: 'admissions.pipeline',
    pathPrefix: '/api/v1/admissions',
    resource: 'registration',
    deferredDomainGuard: false,
  },
  {
    id: 'communication.staff',
    pathPrefix: '/api/v1/communication',
    resource: 'communication',
    deferredDomainGuard: false,
  },
  {
    id: 'lms.staff',
    pathPrefix: '/api/v1/lms',
    resource: 'lms',
    deferredDomainGuard: false,
  },
  {
    id: 'attendance.record',
    pathPrefix: '/api/v1/attendance',
    resource: 'attendance',
    deferredDomainGuard: false,
  },
  {
    id: 'notification.staff',
    pathPrefix: '/api/v1/notifications',
    resource: 'notification',
    deferredDomainGuard: false,
  },
];

/** Full inventory: overrides first, then per-segment defaults. */
export const MUTATING_ROUTE_AUTHZ_INVENTORY: readonly MutatingAuthzInventoryRule[] = [
  ...MUTATING_AUTHZ_EXACT_OVERRIDES,
  ...buildSegmentRules(),
];

export function inventoryKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function normalizePath(urlOrPath: string): string {
  const path = urlOrPath.split('?')[0] ?? urlOrPath;
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function ruleMatches(rule: MutatingAuthzInventoryRule, method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (!MUTATING_HTTP_METHODS.has(m)) return false;
  if (rule.methods && !rule.methods.includes(m as 'POST' | 'PUT' | 'PATCH' | 'DELETE')) {
    return false;
  }
  const prefix = rule.pathPrefix.endsWith('/')
    ? rule.pathPrefix.slice(0, -1)
    : rule.pathPrefix;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Resolve the inventory-declared exact guard for a mutating request.
 * Returns undefined when no rule covers the path (caller must fail closed).
 */
export function resolveExactMutatingAuthz(
  method: string,
  urlOrPath: string,
): ExactMutatingAuthzGuard | undefined {
  const m = method.toUpperCase();
  if (!MUTATING_HTTP_METHODS.has(m)) return undefined;

  const path = normalizePath(urlOrPath);
  if (!path.startsWith('/api/v1/')) return undefined;
  if (path.startsWith('/api/v1/auth/') || path === '/api/v1/auth') return undefined;

  const rest = path.slice('/api/v1/'.length);
  const segment = rest.split('/').filter(Boolean)[0];
  if (segment && GATEWAY_UTILITY_SEGMENTS.has(segment)) return undefined;

  let best: MutatingAuthzInventoryRule | undefined;
  for (const rule of MUTATING_ROUTE_AUTHZ_INVENTORY) {
    if (!ruleMatches(rule, m, path)) continue;
    if (!best || rule.pathPrefix.length > best.pathPrefix.length) {
      best = rule;
    }
  }
  if (!best) return undefined;

  return {
    resource: best.resource,
    action: best.action ?? actionForMethod(m),
    domainAction: best.domainAction,
    ruleId: best.id,
    deferredDomainGuard: best.deferredDomainGuard === true,
  };
}

export interface RegisteredMutatingRoute {
  method: string;
  path: string;
}

/**
 * Track mutating routes registered on the gateway for inventory coverage tests.
 */
export function attachMutatingRouteAuthzTracker(app: FastifyInstance): {
  getRegistered: () => readonly RegisteredMutatingRoute[];
} {
  const registered: RegisteredMutatingRoute[] = [];

  app.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const path = typeof route.url === 'string' ? route.url : route.path;
    if (typeof path !== 'string') return;
    const normalized = normalizePath(path);
    if (!normalized.startsWith('/api/v1/')) return;
    if (normalized.startsWith('/api/v1/auth/') || normalized === '/api/v1/auth') return;

    for (const method of methods) {
      const m = String(method).toUpperCase();
      if (!MUTATING_HTTP_METHODS.has(m)) continue;
      registered.push({ method: m, path: normalized });
    }
  });

  if (!app.hasDecorator('mutatingRouteAuthzRegistry')) {
    app.decorate('mutatingRouteAuthzRegistry', {
      getRegistered: () => registered,
    });
  }

  return {
    getRegistered: () => registered,
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    mutatingRouteAuthzRegistry?: {
      getRegistered: () => readonly RegisteredMutatingRoute[];
    };
  }
}

export type ExactAuthzDenyReason =
  | 'missing_inventory_guard'
  | 'unmapped_resource'
  | 'forbidden';

/**
 * Enforce inventory-declared exact resource/action for mutating /api/v1 routes.
 *
 * @returns null when the request should continue; otherwise a deny payload.
 * Callers that receive `missing_inventory_guard` must fail closed (403).
 */
export function evaluateExactMutatingAuthzGate(input: {
  method: string;
  url: string;
  isPlatformAdmin: boolean;
}):
  | { ok: true; guard: ExactMutatingAuthzGuard | null }
  | { ok: false; reason: ExactAuthzDenyReason; message: string; guard?: ExactMutatingAuthzGuard } {
  const method = input.method.toUpperCase();
  if (!MUTATING_HTTP_METHODS.has(method)) {
    return { ok: true, guard: null };
  }

  const path = normalizePath(input.url);
  if (!path.startsWith('/api/v1/')) return { ok: true, guard: null };
  if (path.startsWith('/api/v1/auth/') || path === '/api/v1/auth') {
    return { ok: true, guard: null };
  }

  const rest = path.slice('/api/v1/'.length);
  const segment = rest.split('/').filter(Boolean)[0];
  if (segment && GATEWAY_UTILITY_SEGMENTS.has(segment)) {
    return { ok: true, guard: null };
  }

  const guard = resolveExactMutatingAuthz(method, path);
  if (!guard) {
    // Platform admins may probe unmapped control paths, but inventory miss on
    // a mutating tenant route is still a security defect — fail closed for all.
    if (input.isPlatformAdmin) {
      const coarse = resourceForApiPath(path);
      if (coarse === 'platform') {
        return {
          ok: true,
          guard: {
            resource: 'platform',
            action: actionForMethod(method),
            ruleId: 'platform-admin-bypass',
            deferredDomainGuard: false,
          },
        };
      }
    }
    return {
      ok: false,
      reason: 'missing_inventory_guard',
      message:
        'Mutating route has no inventory-declared resource/action guard (W1-SEC-02 fail-closed)',
    };
  }

  if (guard.resource === UNMAPPED_API_RESOURCE) {
    if (input.isPlatformAdmin) return { ok: true, guard };
    return {
      ok: false,
      reason: 'unmapped_resource',
      message: 'No RBAC resource is mapped for this path (default-deny)',
      guard,
    };
  }

  return { ok: true, guard };
}

/**
 * List registered mutating routes that are not covered by the inventory.
 * Used by the coverage test — new routes under deferred plugins must be added.
 */
export function findUninventoriedMutatingRoutes(
  registered: readonly RegisteredMutatingRoute[],
): RegisteredMutatingRoute[] {
  return registered.filter((route) => !resolveExactMutatingAuthz(route.method, route.path));
}

/** Inventory rules marked deferred (honest residual for package domain guards). */
export function listDeferredMutatingAuthzRules(): MutatingAuthzInventoryRule[] {
  return MUTATING_ROUTE_AUTHZ_INVENTORY.filter((r) => r.deferredDomainGuard === true);
}

/**
 * Denial-matrix samples drawn from the inventory for insufficient-permission tests.
 */
export const INVENTORY_DENY_SAMPLES: ReadonlyArray<{
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  deniedRole: string;
  /** Role expected to clear the gateway exact guard (may still 4xx from domain). */
  allowedRole: string;
  payload?: Record<string, unknown>;
}> = [
  {
    id: 'examination.documents',
    method: 'POST',
    url: '/api/v1/examinations/11111111-1111-4111-8111-111111111111/documents/generate',
    deniedRole: 'teacher',
    allowedRole: 'admin',
    payload: { documentType: 'ADMIT_CARD', candidateIds: [] },
  },
  {
    id: 'fees.invoices',
    method: 'POST',
    url: '/api/v1/fees/invoices',
    deniedRole: 'parent',
    allowedRole: 'admin',
    payload: { studentId: '33333333-3333-4333-8333-333333333333', amount: 100 },
  },
  {
    id: 'hostel.leaves',
    method: 'POST',
    url: '/api/v1/hostel/leaves',
    deniedRole: 'teacher',
    allowedRole: 'admin',
    payload: {
      studentId: '33333333-3333-4333-8333-333333333333',
      hostelId: 'b1000000-0000-4000-8000-000000000001',
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      reason: 'W1-SEC-02 inventory deny',
    },
  },
  {
    id: 'transport.vehicles',
    method: 'POST',
    url: '/api/v1/transport/vehicles',
    deniedRole: 'parent',
    allowedRole: 'admin',
    payload: { plateNumber: 'SEC02-1', capacity: 20 },
  },
  {
    id: 'library.circulation',
    method: 'POST',
    url: '/api/v1/library/circulation/checkout',
    deniedRole: 'parent',
    allowedRole: 'admin',
    payload: {
      itemId: 'd1000000-0000-4000-8000-000000000001',
      borrowerId: '33333333-3333-4333-8333-333333333333',
    },
  },
  {
    id: 'registration.staff',
    method: 'POST',
    url: '/api/v1/registrations/applications/00000000-0000-4000-8000-000000000001/status',
    deniedRole: 'teacher',
    allowedRole: 'admin',
    payload: { status: 'under_review' },
  },
  {
    id: 'scholarship.programs',
    method: 'POST',
    url: '/api/v1/scholarships/programs',
    deniedRole: 'teacher',
    allowedRole: 'admin',
    payload: { name: 'Merit' },
  },
  {
    id: 'staff.create',
    method: 'POST',
    url: '/api/v1/staff',
    deniedRole: 'teacher',
    allowedRole: 'admin',
    payload: {
      firstName: 'Pat',
      lastName: 'Lee',
      dateOfBirth: '1985-06-15',
      identityNumber: 'EMP-SEC02',
      contactPhone: '+15550001111',
      position: 'Teacher',
    },
  },
];

/** Helper for tests: assert a role is a known platform admin id. */
export function isPlatformAdminRoleId(roleId: string): boolean {
  return PLATFORM_ADMIN_ROLE_IDS.has(roleId);
}

/**
 * Optional reply helper when a preHandler wants to short-circuit.
 * Gateway `onRequest` sends JSON directly; this is for package reuse.
 */
export async function replyMissingExactAuthzGuard(
  reply: FastifyReply,
  request: FastifyRequest,
): Promise<void> {
  request.log.warn(
    { method: request.method, url: request.url },
    'W1-SEC-02 missing inventory exact authz guard',
  );
  await reply.status(403).send({
    code: 'FORBIDDEN',
    message:
      'Mutating route has no inventory-declared resource/action guard (W1-SEC-02 fail-closed)',
    statusCode: 403,
  });
}
