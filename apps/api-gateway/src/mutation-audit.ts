/**
 * G-105 / W1-SEC-10 — helpers for gateway mutation audit trail.
 *
 * PARTIAL (fail-closed onSend) closed to COMPLETE for regulated routes that
 * commit domain state + audit/outbox in the same transaction. Post-hoc onSend
 * remains a safety net for unwired regulated paths (see residual list in
 * docs/audits/SEC_W1_SEC_10_COMPLETE.md) but cannot roll back an unaudited write.
 *
 * Production never honors ALLOW_MUTATION_AUDIT_DEGRADE (no production bypass).
 */

import { createHash } from 'node:crypto';

import type { AuditOperation } from '@proctira/backend-audit';
import type { FastifyRequest } from 'fastify';

import { resourceForApiPath } from './rbac-registry.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** RBAC resources where a missing audit trail is a security incident. */
const SECURITY_SENSITIVE_RESOURCES = new Set([
  'health',
  'fees',
  'scholarship',
  'student',
  'parent',
  'registration',
  'staff',
  'platform',
  'billing',
]);

/**
 * Regulated HTTP path prefixes that write domain state + audit in one txn
 * (W1-SEC-10 COMPLETE subset). Handlers must call
 * {@link markRegulatedMutationAuditCommitted} after a successful atomic write.
 */
export const ATOMIC_MUTATION_AUDIT_PATH_PREFIXES = [
  '/api/v1/health/measurements',
  '/api/v1/fees/payments',
] as const;

const REQUEST_AUDIT_COMMITTED = Symbol.for('proctira.mutationAuditCommitted');

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function shouldAuditMutation(method: string, url: string): boolean {
  if (!MUTATING.has(method.toUpperCase())) return false;
  const path = url.split('?')[0] ?? url;
  if (!path.startsWith('/api/v1/')) return false;
  if (path.startsWith('/api/v1/auth/') || path === '/api/v1/auth') return false;
  if (path.startsWith('/api/v1/audit-logs')) return false;
  if (path.startsWith('/docs') || path === '/docs') return false;
  if (path.startsWith('/health') || path === '/health') return false;
  return true;
}

export function operationForMethod(method: string): AuditOperation {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'CREATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return 'UPDATE';
  }
}

export function entityTypeForPath(pathname: string): string {
  const resource = resourceForApiPath(pathname);
  if (resource === 'health') return 'health_record';
  if (resource === 'platform') return 'user';
  if (resource) return resource;
  const segment = pathname.replace(/^\/api\/v1\//, '').split('/')[0];
  return segment || 'api';
}

export function entityIdFromPath(pathname: string): string {
  const path = pathname.split('?')[0] ?? pathname;
  const segments = path.split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i]!;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) {
      return seg;
    }
  }
  return segments[segments.length - 1] ?? 'collection';
}

export function hashValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
}

/**
 * V15-15 — statuses that mean "this mutation was refused", not "this mutation failed".
 *
 * A refusal is an authorization decision and belongs in the audit trail. A 4xx validation
 * failure is a different thing (the caller was allowed, the payload was wrong) and was
 * already recorded; a 5xx is a fault and is deliberately not recorded as a decision.
 */
export function isDeniedMutationStatus(statusCode: number): boolean {
  return statusCode === 401 || statusCode === 403;
}

/**
 * The audit row body for one mutation attempt.
 *
 * Extracted from the gateway's `onSend` hook so the denial rules are testable without
 * booting the whole app — the hook previously decided this inline and nothing covered it,
 * which is how `return payload` on 403 survived.
 */
export function mutationAuditPayloadFor(options: {
  operation: AuditOperation;
  request: FastifyRequest;
  statusCode: number;
  method: string;
  path: string;
}): {
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
} {
  const denied = isDeniedMutationStatus(options.statusCode);

  // Both null for a denial: nothing changed, and the body of a refused call is
  // unvalidated caller-controlled data that must not be persisted — not even as the hash
  // `buildAuditValues` would otherwise store.
  const values = denied
    ? { beforeValues: null, afterValues: null }
    : buildAuditValues(options.operation, options.request);

  return {
    ...values,
    metadata: {
      method: options.method,
      path: options.path,
      statusCode: options.statusCode,
      outcome: denied ? 'denied' : 'applied',
    },
  };
}

export function buildAuditValues(
  operation: AuditOperation,
  request: FastifyRequest,
): {
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
} {
  const bodyHash = hashValue(request.body);
  const path = request.url.split('?')[0] ?? request.url;

  if (operation === 'CREATE') {
    return { beforeValues: null, afterValues: { bodyHash, path } };
  }
  if (operation === 'DELETE') {
    return { beforeValues: { path }, afterValues: null };
  }
  return {
    beforeValues: { bodyHash: 'pre-mutation', path },
    afterValues: { bodyHash, path },
  };
}

/**
 * Paths whose mutations must not acknowledge success without a durable audit
 * record in production (PHI / money / custody / privacy / identity).
 */
export function isSecuritySensitiveMutationPath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? pathname;
  if (
    path.startsWith('/api/v1/billing') ||
    path.startsWith('/api/v1/tenant-lifecycle') ||
    path.startsWith('/api/v1/privacy')
  ) {
    return true;
  }
  const resource = resourceForApiPath(path);
  return resource != null && SECURITY_SENSITIVE_RESOURCES.has(resource);
}

export function isAtomicMutationAuditPath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? pathname;
  return ATOMIC_MUTATION_AUDIT_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * V15-16 — the post-hoc residual, enumerated instead of described.
 *
 * `SEC_W1_SEC_10_COMPLETE.md` recorded this residual in prose as "other regulated
 * mutations (allergies, privacy, billing, student, scholarship, …)". Counting the
 * registered routes instead of reading the list gives a different picture: **166 of the 170
 * security-sensitive mutating routes are post-hoc only.** Four are atomic. The prose was
 * not wrong, but "…" was carrying almost the entire finding.
 *
 * Each entry below is a path prefix whose security-sensitive mutations are knowingly
 * audited *after* the domain write commits. That means a failed audit yields a 503 for a
 * change that already happened — see {@link mutationAuditUnavailableBody}.
 *
 * This list is not a fix and must not be read as one. It exists so that the residual is
 * **bounded and cannot grow silently**: `mutation-audit-coverage.test.ts` fails when a
 * registered security-sensitive mutating route is neither atomic nor listed here, so adding
 * one becomes a deliberate act with a reviewer attached rather than an accident. It also
 * fails when an entry here matches no registered route, so the list cannot rot into
 * fiction after a refactor.
 *
 * `count` is the number of registered routes observed under the prefix when the entry was
 * added. It is asserted, so a prefix that quietly doubles fails the gate.
 */
export const POST_HOC_MUTATION_AUDIT_WAIVERS = [
  {
    prefix: '/api/v1/staff',
    count: 26,
    reason: 'HR records and contracts; audit is post-hoc pending same-txn binder',
  },
  {
    prefix: '/api/v1/health',
    count: 22,
    reason:
      'PHI beyond measurements: allergies, conditions, vaccinations, insurance, counselling, break-glass',
  },
  {
    prefix: '/api/v1/fees',
    count: 20,
    reason: 'money movement beyond /fees/payments: invoices, adjustments, refunds, waivers',
  },
  { prefix: '/api/v1/students', count: 15, reason: 'PII and custody records' },
  { prefix: '/api/v1/billing', count: 12, reason: 'subscription and invoice state' },
  { prefix: '/api/v1/parent-portal', count: 12, reason: 'guardian-facing writes on child records' },
  { prefix: '/api/v1/admissions', count: 11, reason: 'applicant PII and offer decisions' },
  { prefix: '/api/v1/tenant-lifecycle', count: 9, reason: 'tenant suspend/restore/purge' },
  { prefix: '/api/v1/scholarships', count: 9, reason: 'financial award decisions' },
  { prefix: '/api/v1/privacy', count: 9, reason: 'DSAR, erasure and legal-hold actions' },
  { prefix: '/api/v1/tenants', count: 5, reason: 'tenant configuration' },
  { prefix: '/api/v1/registrations', count: 5, reason: 'public registration intake' },
  { prefix: '/api/v1/enrollments', count: 4, reason: 'enrolment state transitions' },
  { prefix: '/api/v1/plugins', count: 4, reason: 'plugin enablement affects data access' },
  { prefix: '/api/v1/break-glass', count: 3, reason: 'emergency access grants' },
] as const;

export function isPostHocAuditWaived(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? pathname;
  return POST_HOC_MUTATION_AUDIT_WAIVERS.some(
    (w) => path === w.prefix || path.startsWith(`${w.prefix}/`),
  );
}

/**
 * Security-sensitive mutating routes that are neither atomic nor waived.
 *
 * A non-empty result is a new gap: a route handling PHI, money, custody, privacy or
 * identity whose audit trail nobody has decided about.
 */
export function findUnaccountedSensitiveMutations(
  registered: readonly { method: string; path: string }[],
): { method: string; path: string }[] {
  return registered
    .filter((r) => shouldAuditMutation(r.method, r.path))
    .filter((r) => isSecuritySensitiveMutationPath(r.path))
    .filter((r) => !isAtomicMutationAuditPath(r.path))
    .filter((r) => !isPostHocAuditWaived(r.path))
    .map((r) => ({ method: r.method, path: r.path }));
}

/** Waiver entries whose prefix matches no registered route, or whose count has drifted. */
export function findStalePostHocWaivers(
  registered: readonly { method: string; path: string }[],
): { prefix: string; expected: number; actual: number }[] {
  const sensitive = registered
    .filter((r) => shouldAuditMutation(r.method, r.path))
    .filter((r) => isSecuritySensitiveMutationPath(r.path))
    .filter((r) => !isAtomicMutationAuditPath(r.path));

  return POST_HOC_MUTATION_AUDIT_WAIVERS.map((w) => {
    const actual = sensitive.filter(
      (r) => r.path === w.prefix || r.path.startsWith(`${w.prefix}/`),
    ).length;
    return { prefix: w.prefix, expected: w.count, actual };
  }).filter((r) => r.actual !== r.expected);
}

/**
 * Emergency degrade is never available in production (W1-SEC-10 COMPLETE).
 * Non-production may set ALLOW_MUTATION_AUDIT_DEGRADE=1 for local tooling.
 */
export function isMutationAuditDegradeAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.NODE_ENV ?? '').toLowerCase() === 'production') return false;
  return truthy(env.ALLOW_MUTATION_AUDIT_DEGRADE);
}

/**
 * When mutation audit persistence fails: fail closed for security-sensitive
 * paths in production. Degrade flag is ignored in production.
 */
export function shouldFailClosedOnMutationAuditFailure(options: {
  path: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = options.env ?? process.env;
  if (isMutationAuditDegradeAllowed(env)) return false;
  if (!isSecuritySensitiveMutationPath(options.path)) return false;
  return (env.NODE_ENV ?? '').toLowerCase() === 'production';
}

/**
 * V15-16 — the body returned when a mutation committed but its audit row did not.
 *
 * ## Why the old message was wrong
 *
 * It read "refusing to acknowledge security-sensitive mutation", which tells the caller
 * nothing happened. For every path except the four atomic ones, **the domain write has
 * already committed** by the time this hook runs — `onSend` is after the handler. So the
 * message described the opposite of the actual state, and a client acting on it would
 * retry a `POST` that had already succeeded and create a duplicate.
 *
 * This code is only ever emitted on the post-hoc path: the atomic routes return early via
 * `wasRegulatedMutationAuditCommitted`, and when *their* transaction fails the write rolls
 * back and the caller gets a domain error instead. So "the mutation may have been applied"
 * is not a hedge here — it is the normal case.
 *
 * ## Why it is a function now
 *
 * `requestId` has to be stamped at construction. The `onSend` hook in `error-handler.ts`
 * that stamps every other error body is registered before this one (`app.ts:222` vs
 * `app.ts:838`) and Fastify runs `onSend` hooks in registration order, so by the time this
 * payload exists the stamping hook has already run and seen a 2xx. Verified by execution,
 * not inferred: the previous constant went out with no `requestId` at all — on the single
 * response where a user most needs to ask "did my payment actually save?" and support needs
 * an identifier to reconcile against the log.
 */
export function mutationAuditUnavailableBody(requestId?: string): {
  code: 'AUDIT_UNAVAILABLE';
  message: string;
  statusCode: 503;
  retryable: false;
  requestId?: string;
} {
  return {
    code: 'AUDIT_UNAVAILABLE',
    message:
      'The change may have been applied but could not be recorded in the audit trail. ' +
      'Do not retry: quote the request id and confirm the current state before acting.',
    statusCode: 503,
    // Not retryable, and this is the whole point of the message. The registry previously
    // published `retryable: true` for this code, which told integrators it was safe to
    // repeat a write that had already landed.
    retryable: false,
    ...(requestId ? { requestId } : {}),
  };
}

/**
 * Retained because the shape is referenced as a contract fixture. Prefer
 * {@link mutationAuditUnavailableBody}, which carries the request id.
 */
export const MUTATION_AUDIT_UNAVAILABLE_BODY = mutationAuditUnavailableBody();

export type MutationAuditRecordInput = {
  tenantId: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  userId: string;
  userName: string;
  ipAddress: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

export type MutationAuditRecorder = {
  recordAudit: (input: MutationAuditRecordInput) => Promise<unknown>;
};

export type MutationAuditOutcome =
  { ok: true } | { ok: false; failClosed: boolean; error: unknown };

/**
 * Attempt to persist a mutation audit record. Never swallows: callers must
 * log `error` when `ok` is false. When `failClosed` is true, replace the
 * outbound success response with {@link MUTATION_AUDIT_UNAVAILABLE_BODY}.
 */
export async function persistMutationAudit(options: {
  auditService: MutationAuditRecorder | null | undefined;
  input: MutationAuditRecordInput;
  path: string;
  env?: NodeJS.ProcessEnv;
}): Promise<MutationAuditOutcome> {
  const env = options.env ?? process.env;
  try {
    if (!options.auditService || typeof options.auditService.recordAudit !== 'function') {
      throw new Error('audit service unavailable');
    }
    await options.auditService.recordAudit(options.input);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      failClosed: shouldFailClosedOnMutationAuditFailure({ path: options.path, env }),
      error,
    };
  }
}

type AuditMarkedRequest = FastifyRequest & {
  [REQUEST_AUDIT_COMMITTED]?: boolean;
};

/** Mark that regulated domain state + audit already committed atomically. */
export function markRegulatedMutationAuditCommitted(request: FastifyRequest): void {
  (request as AuditMarkedRequest)[REQUEST_AUDIT_COMMITTED] = true;
}

export function wasRegulatedMutationAuditCommitted(request: FastifyRequest): boolean {
  return (request as AuditMarkedRequest)[REQUEST_AUDIT_COMMITTED] === true;
}
