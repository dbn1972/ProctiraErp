/** Insights & System data provenance for honesty banners. */
export type ScaffoldDataSource = 'gateway' | 'scaffold';

export function scaffoldSourceFromResponse(
  ok: boolean,
  status: number,
): ScaffoldDataSource {
  // status > 0 means the gateway was reached (including 4xx/5xx).
  return ok || status > 0 ? 'gateway' : 'scaffold';
}
