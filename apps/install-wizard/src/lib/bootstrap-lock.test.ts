import { describe, expect, it, beforeEach } from 'vitest';

import {
  BOOTSTRAP_STEPS,
  clearInstallSessions,
  createInstallSession,
  finalizeSession,
  getBootstrapStatus,
  markStepComplete,
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
});
