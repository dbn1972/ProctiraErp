/**
 * Public status-page probe helpers.
 * Keep pure so unit tests can assert honest prelaunch vs probed modes
 * without spinning Next.js.
 */

export type ProbeState = 'ok' | 'degraded' | 'unreachable' | 'unmonitored';

export interface StatusProbeUrls {
  web?: string;
  api?: string;
  auth?: string;
}

export interface StatusSnapshot {
  mode: 'probed' | 'prelaunch';
  probedAt: string | null;
  probes: Partial<Record<'web' | 'api' | 'auth', ProbeState>>;
}

export function readStatusProbeUrlsFromEnv(
  env: Record<string, string | undefined> = process.env,
): StatusProbeUrls {
  return {
    web: env.STATUS_PROBE_WEB_URL?.trim() || undefined,
    api: env.STATUS_PROBE_API_URL?.trim() || undefined,
    auth: env.STATUS_PROBE_AUTH_URL?.trim() || undefined,
  };
}

export function hasConfiguredProbes(urls: StatusProbeUrls): boolean {
  return Boolean(urls.web || urls.api || urls.auth);
}

export async function probeUrl(
  url: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeState> {
  if (!url) return 'unmonitored';
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      // A redirect (e.g. to a login page) is not a healthy probe response.
      redirect: 'manual',
      signal: AbortSignal.timeout(3_000),
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    // Only a direct 2xx counts as healthy; 3xx/4xx/5xx are all degraded.
    return response.ok ? 'ok' : 'degraded';
  } catch {
    return 'unreachable';
  }
}

export async function loadStatusSnapshot(
  urls: StatusProbeUrls,
  options?: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
  },
): Promise<StatusSnapshot> {
  if (!hasConfiguredProbes(urls)) {
    return { mode: 'prelaunch', probedAt: null, probes: {} };
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = options?.now ?? (() => new Date());
  const [webState, apiState, authState] = await Promise.all([
    probeUrl(urls.web, fetchImpl),
    probeUrl(urls.api, fetchImpl),
    probeUrl(urls.auth, fetchImpl),
  ]);

  return {
    mode: 'probed',
    probedAt: now().toISOString(),
    probes: {
      web: webState,
      api: apiState,
      auth: authState,
    },
  };
}

/** Default TTL for the cached status snapshot (status page probes at most once per window). */
export const STATUS_SNAPSHOT_TTL_MS = 30_000;

/**
 * Wrap a snapshot loader in a small in-process TTL cache so every status
 * page view does not fan out a fresh probe set. Concurrent callers within
 * the window share one in-flight probe.
 */
export function createCachedSnapshotLoader(
  loader: () => Promise<StatusSnapshot>,
  options?: { ttlMs?: number; nowMs?: () => number },
): () => Promise<StatusSnapshot> {
  const ttlMs = options?.ttlMs ?? STATUS_SNAPSHOT_TTL_MS;
  const nowMs = options?.nowMs ?? (() => Date.now());
  let cached: { at: number; value: Promise<StatusSnapshot> } | null = null;
  return () => {
    const t = nowMs();
    if (cached && t - cached.at < ttlMs) return cached.value;
    const value = loader();
    const entry = { at: t, value };
    cached = entry;
    // Do not pin a failed load for the whole TTL.
    value.catch(() => {
      if (cached === entry) cached = null;
    });
    return value;
  };
}
