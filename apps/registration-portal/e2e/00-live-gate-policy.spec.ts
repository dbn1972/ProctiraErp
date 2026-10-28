import { expect, test } from '@playwright/test';
import { liveJourneyGate } from './helpers/live-gate';

/**
 * PRC-M568 — policy for the fail-closed live gate in
 * 03-registration-live-journey.spec.ts. Pure env logic, no browser.
 */
const MAIN = 'refs/heads/main';

test.describe('Registration Portal — live gate policy', () => {
  test('main without an opt-out still requires the live journey', () => {
    expect(liveJourneyGate({ GITHUB_REF: MAIN }).required).toBe(true);
  });

  test('main with E2E_LIVE_LANE=none skips with a clear reason', () => {
    const gate = liveJourneyGate({ GITHUB_REF: MAIN, E2E_LIVE_LANE: 'none' });
    expect(gate.required).toBe(false);
    expect(gate.reason).toContain('E2E_LIVE_LANE=none');
    expect(gate.reason).toContain('backend-less lane');
  });

  test('the opt-out is exact-match, not truthy', () => {
    for (const value of ['', 'NONE', 'None', ' none', 'none ', 'true', '1', 'yes', 'off']) {
      expect(liveJourneyGate({ GITHUB_REF: MAIN, E2E_LIVE_LANE: value }).required, value).toBe(
        true,
      );
    }
  });

  test('E2E_REQUIRE_LIVE=1 always enforces, even with the opt-out', () => {
    for (const ref of [MAIN, 'refs/pull/690/merge', undefined]) {
      expect(liveJourneyGate({ GITHUB_REF: ref, E2E_REQUIRE_LIVE: '1' }).required).toBe(true);
      expect(
        liveJourneyGate({ GITHUB_REF: ref, E2E_REQUIRE_LIVE: '1', E2E_LIVE_LANE: 'none' }).required,
      ).toBe(true);
    }
  });

  test('non-main refs without E2E_REQUIRE_LIVE do not require the live journey', () => {
    expect(liveJourneyGate({}).required).toBe(false);
    expect(liveJourneyGate({ GITHUB_REF: 'refs/pull/690/merge' }).required).toBe(false);
    expect(liveJourneyGate({ GITHUB_REF: 'refs/heads/develop' }).required).toBe(false);
  });
});
