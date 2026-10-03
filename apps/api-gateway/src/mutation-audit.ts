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
/**
 * PRC-L306: fees money movements whose audit row is written in the same
 * transaction as the refund / credit note / write-off / void / concession
 * approval (see fees-plugin buildMoneyAuditSink). Pg only; in-memory falls
 * back to the post-hoc onSend audit.
 */
export const ATOMIC_MUTATION_AUDIT_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/v1\/fees\/invoices\/[^/]+\/(refund|credit-notes|write-offs|void|pay)$/,
  /^\/api\/v1\/fees\/concessions\/[^/]+\/approve$/,
];

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

/** Top-level field names a request body touches (never values — may be PII/PHI). */
export function changedFieldNames(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) return [];
  return Object.keys(body as Record<string, unknown>).sort();
}

/**
 * PRC-M013: the post-hoc audit cannot see domain before-state, so it records
 * no fabricated placeholder (`bodyHash: 'pre-mutation'` was removed) — only the
 * changed field names and a body hash. Real before/after values come from the
 * same-transaction domain audit on {@link ATOMIC_MUTATION_AUDIT_PATH_PREFIXES}.
 */
export function buildAuditValues(
  operation: AuditOperation,
  request: FastifyRequest,
): {
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
} {
  const bodyHash = hashValue(request.body);
  const path = request.url.split('?')[0] ?? request.url;
  const changedFields = changedFieldNames(request.body);

  if (operation === 'DELETE') {
    return { beforeValues: { path }, afterValues: null };
  }
  return { beforeValues: null, afterValues: { bodyHash, path, changedFields } };
}

/**
 * PRC-M013: prefer the id the handler actually created/changed (response body
 * `id`) over a path segment; never the literal 'collection'.
 */
export function resolveAuditEntityId(pathname: string, payload: unknown): string {
  if (typeof payload === 'string' && payload.length > 0 && payload.length < 1_000_000) {
    try {
      const parsed = JSON.parse(payload) as { id?: unknown; data?: { id?: unknown } } | null;
      const id = parsed?.id ?? parsed?.data?.id;
      if (typeof id === 'string' && id) return id;
      if (typeof id === 'number') return String(id);
    } catch {
      // non-JSON body — fall back to the path
    }
  }
  const segments = (pathname.split('?')[0] ?? pathname).split('/').filter(Boolean);
  const fromPath = entityIdFromPath(pathname);
  return fromPath === segments[segments.length - 1] && segments.length <= 3
    ? 'unresolved'
    : fromPath;
}

/**
 * PRC-M013: only state-changing outcomes become mutation audit rows. A 4xx
 * response changed nothing, so it must not appear as a CREATE/UPDATE/DELETE.
 */
export function isAuditableMutationOutcome(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 400;
}

/**
 * PRC-M014: cached audit-store availability. Security-sensitive production
 * mutations are rejected *before* the handler runs when the audit store is
 * known/probed unavailable, so no unaudited write is committed. A post-commit
 * audit failure trips the breaker for `ttlMs`.
 */
export class AuditAvailabilityGate {
  private state: { ok: boolean; at: number } | undefined;
  private inFlight: Promise<boolean> | undefined;

  constructor(
    private readonly probe: () => Promise<void>,
    private readonly ttlMs = 5000,
    private readonly timeoutMs = 1500,
    private readonly now: () => number = Date.now,
  ) {}

  markUnavailable(): void {
    this.state = { ok: false, at: this.now() };
  }

  async isAvailable(): Promise<boolean> {
    if (this.state && this.now() - this.state.at < this.ttlMs) return this.state.ok;
    this.inFlight ??= this.runProbe().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runProbe(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.probe(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('audit probe timed out')), this.timeoutMs);
        }),
      ]);
      this.state = { ok: true, at: this.now() };
    } catch {
      this.state = { ok: false, at: this.now() };
    } finally {
      if (timer) clearTimeout(timer);
    }
    return this.state.ok;
  }
}

/**
 * PRC-M014: bounded in-process retry for an audit row whose write failed
 * *after* the mutation committed. The client keeps the true 2xx (no ambiguous
 * 503 that invites a duplicate retry); the row is retried with backoff.
 */
export class MutationAuditRetryQueue {
  private pending = 0;
  constructor(
    private readonly recorder: () => MutationAuditRecorder | null | undefined,
    private readonly onGiveUp: (input: MutationAuditRecordInput, error: unknown) => void,
    private readonly delaysMs: readonly number[] = [1000, 5000, 30000],
    private readonly maxPending = 1000,
  ) {}

  get size(): number {
    return this.pending;
  }

  enqueue(input: MutationAuditRecordInput): boolean {
    if (this.pending >= this.maxPending) {
      this.onGiveUp(input, new Error('audit retry queue full'));
      return false;
    }
    this.pending += 1;
    const attempt = (index: number) => {
      const timer = setTimeout(() => {
        void (async () => {
          try {
            const recorder = this.recorder();
            if (!recorder) throw new Error('audit service unavailable');
            await recorder.recordAudit(input);
            this.pending -= 1;
          } catch (error) {
            if (index + 1 < this.delaysMs.length) attempt(index + 1);
            else {
              this.pending -= 1;
              this.onGiveUp(input, error);
            }
          }
        })();
      }, this.delaysMs[index]);
      timer.unref?.();
    };
    attempt(0);
    return true;
  }
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
  return (
    ATOMIC_MUTATION_AUDIT_PATH_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ) || ATOMIC_MUTATION_AUDIT_PATH_PATTERNS.some((pattern) => pattern.test(path))
  );
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

export const MUTATION_AUDIT_UNAVAILABLE_BODY = {
  code: 'AUDIT_UNAVAILABLE',
  message: 'Mutation audit trail unavailable; refusing to acknowledge security-sensitive mutation',
  statusCode: 503,
} as const;

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
