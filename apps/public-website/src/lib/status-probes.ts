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
  env: NodeJS.ProcessEnv = process.env,
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
      signal: AbortSignal.timeout(3_000),
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (response.ok) return 'ok';
    if (response.status >= 500) return 'degraded';
    return 'degraded';
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
