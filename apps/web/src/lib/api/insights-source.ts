/** Insights & System data provenance for honesty banners. */

/**
 * Data provenance states.
 *
 * - `gateway`     — a live upstream responded 2xx; data is real.
 * - `scaffold`    — the gateway was never reached (network/offline); data is
 *                   demo/scaffold only.
 * - `denied`      — the gateway responded but rejected access (401/403). An
 *                   empty list here means "you may not see this", NOT "no rows
 *                   exist". Must never render as live/empty (PRC-L267,
 *                   NEW-g1b_web-001).
 * - `unavailable` — the gateway responded with another error (4xx/5xx). The
 *                   data could not be fetched; an empty list is not authoritative.
 */
export type ScaffoldDataSource = 'gateway' | 'scaffold' | 'denied' | 'unavailable';

/**
 * Classify a gateway response into a provenance state.
 *
 * The previous implementation collapsed every reached response (including 4xx
 * and 5xx) to `'gateway'`, so a denial or outage rendered as a live-but-empty
 * surface — masking real data and misleading operators. We now fail closed:
 * only a 2xx (`ok`) counts as `'gateway'`.
 */
export function scaffoldSourceFromResponse(ok: boolean, status: number): ScaffoldDataSource {
  if (ok) return 'gateway';
  // The gateway was never reached (no HTTP status) — offline/scaffold.
  if (!status || status <= 0) return 'scaffold';
  // Access rejected: an empty list is "not permitted", not "no rows".
  if (status === 401 || status === 403) return 'denied';
  // Any other upstream error: data unavailable, empty list not authoritative.
  return 'unavailable';
}

/** True when the surface is showing authoritative live data. */
export function isLiveSource(source: ScaffoldDataSource | undefined): boolean {
  return source === 'gateway';
}
