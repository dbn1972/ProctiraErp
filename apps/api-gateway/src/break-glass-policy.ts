/**
 * PRC-H003: server-side break-glass dual control for the platform-admin console routes.
 *
 * Previously the gateway took `requester` from the request body (defaulting to
 * 'ops@proctira.org'), stamped every approval as 'security@proctira.org', approved requests in
 * any status, never compared approver with requester, had no revoke route and never expired a
 * grant. The only separation-of-duties check lived in the console, which can be bypassed.
 *
 * Identity always comes from the verified JWT (`sub`, with email for display). Decisions are
 * pure functions over the stored row so the rules are testable without Fastify.
 */

export const BREAK_GLASS_MAX_MINUTES = 240;
export const BREAK_GLASS_SCOPES = ['read', 'support', 'admin'] as const;
export type BreakGlassScope = (typeof BREAK_GLASS_SCOPES)[number];

export type BreakGlassStatus =
  | 'pending_approval'
  | 'approved'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'denied';

export interface BreakGlassRow {
  id: string;
  /** Display identity of the requester (email, or sub when no email). */
  requester: string;
  /** Verified JWT subject of the requester. Absent on legacy/seed rows. */
  requesterSub?: string;
  targetTenantId: string;
  scope: BreakGlassScope;
  justification: string;
  useCase: string;
  durationMinutes: number;
  status: BreakGlassStatus;
  createdAt: string;
  approver?: string;
  approverSub?: string;
  approvedAt?: string;
  expiresAt?: string;
  decidedBy?: string;
  decidedBySub?: string;
  decidedAt?: string;
  decisionReason?: string;
}

export interface BreakGlassActor {
  sub: string;
  email?: string;
}

export type PolicyResult =
  | { ok: true; row: BreakGlassRow }
  | { ok: false; statusCode: 400 | 403 | 409; code: string; message: string };

/** Display identity for an actor: email when present, otherwise the subject id. */
export function actorLabel(actor: BreakGlassActor): string {
  return actor.email?.trim() || actor.sub;
}

/**
 * True when the actor is (or may be) the person who raised the request. Matches on the verified
 * subject and, as a second signal, on normalised email so one person holding two subjects
 * (IdP migration, re-provisioned account) cannot approve their own request.
 */
export function isRequester(row: BreakGlassRow, actor: BreakGlassActor): boolean {
  if (row.requesterSub && row.requesterSub === actor.sub) return true;
  const actorEmail = actor.email?.trim().toLowerCase();
  const requester = row.requester.trim().toLowerCase();
  if (actorEmail && requester === actorEmail) return true;
  return !row.requesterSub && requester === actor.sub.trim().toLowerCase();
}

/**
 * Lazily expire grants. An active/approved grant expires once its window closes. A grant with no
 * `approverSub` predates server-side dual control (PRC-H003): its requester and duration were
 * body-controlled and it may never have had a second approver, so it is not honoured.
 */
export function applyExpiry(row: BreakGlassRow, now: Date): BreakGlassRow {
  if (row.status !== 'active' && row.status !== 'approved') return row;
  if (!row.approverSub) return { ...row, status: 'expired' };
  if (!row.expiresAt || Date.parse(row.expiresAt) <= now.getTime()) {
    return { ...row, status: 'expired' };
  }
  return row;
}

export function createRequest(
  body: Record<string, unknown>,
  actor: BreakGlassActor,
  now: Date,
  id: string,
): PolicyResult {
  const targetTenantId = typeof body.targetTenantId === 'string' ? body.targetTenantId.trim() : '';
  const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
  if (!targetTenantId || justification.length < 20) {
    return {
      ok: false,
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'targetTenantId and justification (≥20 chars) are required',
    };
  }
  const scope = body.scope ?? 'read';
  if (typeof scope !== 'string' || !(BREAK_GLASS_SCOPES as readonly string[]).includes(scope)) {
    return { ok: false, statusCode: 400, code: 'VALIDATION_ERROR', message: 'Invalid scope' };
  }
  const durationMinutes = body.durationMinutes ?? 60;
  if (
    typeof durationMinutes !== 'number' ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > BREAK_GLASS_MAX_MINUTES
  ) {
    return {
      ok: false,
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: `durationMinutes must be an integer between 1 and ${BREAK_GLASS_MAX_MINUTES}`,
    };
  }
  return {
    ok: true,
    row: {
      id,
      // Never trust a body-supplied requester.
      requester: actorLabel(actor),
      requesterSub: actor.sub,
      targetTenantId,
      scope: scope as BreakGlassScope,
      justification,
      useCase:
        typeof body.useCase === 'string' && body.useCase.trim()
          ? body.useCase.trim()
          : 'Production incident triage',
      durationMinutes,
      status: 'pending_approval',
      createdAt: now.toISOString(),
    },
  };
}

export function approveRequest(row: BreakGlassRow, actor: BreakGlassActor, now: Date): PolicyResult {
  if (row.status !== 'pending_approval') {
    return {
      ok: false,
      statusCode: 409,
      code: 'INVALID_STATE',
      message: `Only pending requests can be approved (current status: ${row.status})`,
    };
  }
  if (!row.requesterSub) {
    // Pre-fix rows carry a body-supplied requester string; we cannot prove who raised them.
    return {
      ok: false,
      statusCode: 409,
      code: 'RESUBMIT_REQUIRED',
      message: 'This request predates verified requester identity; submit a new request',
    };
  }
  if (isRequester(row, actor)) {
    return {
      ok: false,
      statusCode: 403,
      code: 'SELF_APPROVAL_FORBIDDEN',
      message: 'A break-glass request must be approved by a different operator',
    };
  }
  return {
    ok: true,
    row: {
      ...row,
      status: 'active',
      approver: actorLabel(actor),
      approverSub: actor.sub,
      approvedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + row.durationMinutes * 60_000).toISOString(),
    },
  };
}

export function denyRequest(
  row: BreakGlassRow,
  actor: BreakGlassActor,
  now: Date,
  reason: string | undefined,
): PolicyResult {
  if (row.status !== 'pending_approval') {
    return {
      ok: false,
      statusCode: 409,
      code: 'INVALID_STATE',
      message: `Only pending requests can be denied (current status: ${row.status})`,
    };
  }
  return {
    ok: true,
    row: {
      ...row,
      status: 'denied',
      decidedBy: actorLabel(actor),
      decidedBySub: actor.sub,
      decidedAt: now.toISOString(),
      decisionReason: reason,
    },
  };
}

export function revokeRequest(
  row: BreakGlassRow,
  actor: BreakGlassActor,
  now: Date,
  reason: string | undefined,
): PolicyResult {
  if (row.status !== 'active' && row.status !== 'approved') {
    return {
      ok: false,
      statusCode: 409,
      code: 'INVALID_STATE',
      message: `Only active grants can be revoked (current status: ${row.status})`,
    };
  }
  return {
    ok: true,
    row: {
      ...row,
      status: 'revoked',
      expiresAt: now.toISOString(),
      decidedBy: actorLabel(actor),
      decidedBySub: actor.sub,
      decidedAt: now.toISOString(),
      decisionReason: reason,
    },
  };
}

/**
 * Per-key async mutex: calls sharing a key run one at a time, in arrival order; different keys
 * run independently. Used to serialize break-glass read-check-write decisions per request id,
 * because the keyed document store has no compare-and-set. In-process only — multi-replica
 * deployments still need a conditional update in the store (tracked with PRC-H116).
 */
export function createKeyedLock(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
