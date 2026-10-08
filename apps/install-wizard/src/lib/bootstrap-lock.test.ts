import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  BOOTSTRAP_STEPS,
  clearInstallSessions,
  createInstallSession,
  finalizeSession,
  getBootstrapStatus,
  getInstallSession,
  markStepComplete,
  SESSION_TTL_MS,
} from './bootstrap-lock';

describe('bootstrap-lock session store', () => {
  beforeEach(() => {
    clearInstallSessions();
  });

  it('starts unlocked with all steps pending', () => {
    const session = createInstallSession();
    const status = getBootstrapStatus(session);
    expect(status.isComplete).toBe(false);
    expect(status.pendingSteps).toEqual([...BOOTSTRAP_STEPS]);
  });

  it('enforces step order and locks after finalize', () => {
    const session = createInstallSession();
    expect(markStepComplete(session, 'storage').ok).toBe(false);

    for (const step of BOOTSTRAP_STEPS) {
      expect(markStepComplete(session, step).ok).toBe(true);
    }

    const finalized = finalizeSession(session);
    expect(finalized.ok).toBe(true);
    expect(session.locked).toBe(true);
    expect(getBootstrapStatus(session).isComplete).toBe(true);

    const lockedStep = markStepComplete(session, 'database');
    expect(lockedStep.ok).toBe(false);
    if (!lockedStep.ok) expect(lockedStep.status).toBe(409);

    const lockedFinalize = finalizeSession(session);
    expect(lockedFinalize.ok).toBe(false);
    if (!lockedFinalize.ok) expect(lockedFinalize.status).toBe(409);
  });

  it('rejects finalize when steps are missing', () => {
    const session = createInstallSession();
    markStepComplete(session, 'database');
    const result = finalizeSession(session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/missing steps/i);
    }
  });

  describe('PRC-L005 session expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns a fresh session before the TTL elapses', () => {
      const session = createInstallSession();
      vi.advanceTimersByTime(SESSION_TTL_MS - 1);
      expect(getInstallSession(session.installToken)).not.toBeNull();
    });

    it('treats a session older than the TTL as not found and evicts it', () => {
      const session = createInstallSession();
      vi.advanceTimersByTime(SESSION_TTL_MS + 1);
      expect(getInstallSession(session.installToken)).toBeNull();
      // A second lookup still returns null (entry was deleted).
      expect(getInstallSession(session.installToken)).toBeNull();
    });

    it('sweeps expired sessions when a new one is created', () => {
      const stale = createInstallSession();
      vi.advanceTimersByTime(SESSION_TTL_MS + 1);
      createInstallSession();
      expect(getInstallSession(stale.installToken)).toBeNull();
    });
  });
});
