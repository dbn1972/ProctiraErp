/**
 * Per-session bootstrap lock store for the Install Wizard Next BFF.
 * After finalize, mutating configure/finalize calls are rejected (409).
 */

/** Wizard UI order (differs from Fastify install plugin CDN-first order). */
export const BOOTSTRAP_STEPS = ['database', 'storage', 'cache', 'queue', 'cdn'] as const;

export type BootstrapStep = (typeof BOOTSTRAP_STEPS)[number];

export interface InstallSession {
  installToken: string;
  csrfToken: string;
  completedSteps: Set<BootstrapStep>;
  locked: boolean;
  createdAt: number;
}

const g = globalThis as unknown as {
  __proctiraInstallSessions?: Map<string, InstallSession>;
};

const sessions: Map<string, InstallSession> =
  g.__proctiraInstallSessions ?? new Map<string, InstallSession>();
g.__proctiraInstallSessions = sessions;

/**
 * PRC-L005: sessions are bootstrap-only and must not accumulate forever.
 * Entries older than {@link SESSION_TTL_MS} are treated as expired (the
 * previously-unreachable "expired" path) and swept on insert, and the total
 * is capped so an unauthenticated loop over GET /session cannot grow the heap
 * without bound.
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const MAX_SESSIONS = 1000;

function isExpired(session: InstallSession, now: number): boolean {
  return now - session.createdAt > SESSION_TTL_MS;
}

/** Drop expired entries; if still over the cap, evict the oldest. */
function sweepSessions(now: number = Date.now()): void {
  for (const [token, session] of sessions) {
    if (isExpired(session, now)) sessions.delete(token);
  }
  if (sessions.size <= MAX_SESSIONS) return;
  const ordered = Array.from(sessions.entries()).sort(
    (a, b) => a[1].createdAt - b[1].createdAt,
  );
  for (const [token] of ordered.slice(0, sessions.size - MAX_SESSIONS)) {
    sessions.delete(token);
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createInstallSession(): InstallSession {
  sweepSessions();
  const session: InstallSession = {
    installToken: randomToken(),
    csrfToken: randomToken(),
    completedSteps: new Set(),
    locked: false,
    createdAt: Date.now(),
  };
  sessions.set(session.installToken, session);
  return session;
}

export function getInstallSession(installToken: string | undefined | null): InstallSession | null {
  if (!installToken) return null;
  const session = sessions.get(installToken);
  if (!session) return null;
  // PRC-L005: an expired session is deleted and reported as not found.
  if (isExpired(session, Date.now())) {
    sessions.delete(installToken);
    return null;
  }
  return session;
}

export function getBootstrapStatus(session: InstallSession) {
  const completedSteps = Array.from(session.completedSteps);
  const pendingSteps = BOOTSTRAP_STEPS.filter((s) => !session.completedSteps.has(s));
  return {
    isComplete: session.locked,
    completedSteps,
    pendingSteps: session.locked ? [] : pendingSteps,
    adapterStatuses: Object.fromEntries(
      BOOTSTRAP_STEPS.map((step) => [
        step,
        session.completedSteps.has(step) || session.locked ? 'configured' : 'pending',
      ]),
    ),
  };
}

export function markStepComplete(
  session: InstallSession,
  step: BootstrapStep,
): { ok: true } | { ok: false; status: number; error: string } {
  if (session.locked) {
    return {
      ok: false,
      status: 409,
      error: 'Bootstrap already finalized; install endpoints are locked.',
    };
  }
  const index = BOOTSTRAP_STEPS.indexOf(step);
  const missing = BOOTSTRAP_STEPS.slice(0, index).filter((s) => !session.completedSteps.has(s));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Missing prerequisites: ${missing.join(', ')}`,
    };
  }
  session.completedSteps.add(step);
  return { ok: true };
}

export function finalizeSession(
  session: InstallSession,
): { ok: true; runId: string; completedAt: string } | { ok: false; status: number; error: string } {
  if (session.locked) {
    return {
      ok: false,
      status: 409,
      error: 'Bootstrap already finalized; install endpoints are locked.',
    };
  }
  const missing = BOOTSTRAP_STEPS.filter((s) => !session.completedSteps.has(s));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Cannot finalize: missing steps: ${missing.join(', ')}`,
    };
  }
  session.locked = true;
  return {
    ok: true,
    runId: `local-${session.installToken.slice(0, 8)}`,
    completedAt: new Date().toISOString(),
  };
}

/** Test-only helper */
export function clearInstallSessions(): void {
  sessions.clear();
}
