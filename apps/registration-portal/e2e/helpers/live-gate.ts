/**
 * PRC-M568 — when the live registration journey is mandatory.
 *
 * Fail closed by default on main: a push to refs/heads/main without a live
 * backend fails the gate. A lane that has no backend by design may opt out
 * with the exact value E2E_LIVE_LANE=none (not a truthy check). The opt-out
 * never applies when E2E_REQUIRE_LIVE=1: if both are set, the gate enforces.
 *
 * Lanes that set E2E_LIVE_LANE=none (keep in sync):
 *   - tools/scripts/run-secondary-apps-e2e.sh (secondary-apps-e2e, no gateway)
 *   - .github/workflows/ci.yml "Run integration tests" (turbo test:e2e, no gateway)
 * Never set it in a lane that starts a backend (e.g. e2e-backend-ready.yml).
 */
export const BACKENDLESS_LANE = 'none';

export interface LiveJourneyGate {
  required: boolean;
  reason: string;
}

export function liveJourneyGate(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LiveJourneyGate {
  if (env.E2E_REQUIRE_LIVE === '1') {
    return { required: true, reason: 'E2E_REQUIRE_LIVE=1 requires the live journey' };
  }
  if (env.GITHUB_REF === 'refs/heads/main') {
    if (env.E2E_LIVE_LANE === BACKENDLESS_LANE) {
      return {
        required: false,
        reason:
          'E2E_LIVE_LANE=none: backend-less lane on main; the live journey is enforced only in a lane with a backend',
      };
    }
    return { required: true, reason: 'refs/heads/main requires the live journey' };
  }
  return { required: false, reason: 'live journey not required on this ref' };
}
