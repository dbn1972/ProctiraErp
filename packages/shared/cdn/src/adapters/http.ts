/**
 * PRC-L489: small HTTP helpers shared by the Nginx and custom adapters.
 */
import type { CdnAdapterDeps, CdnAdapterHealth } from '../types.js';

export const DEFAULT_CDN_TIMEOUT_MS = 10_000;

export function resolveFetch(deps: CdnAdapterDeps): typeof fetch {
  return deps.fetchImpl ?? fetch;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Probe the CDN origin: 2xx/3xx → healthy, 4xx → degraded (reachable but refusing),
 * 5xx or a transport error → unhealthy.
 */
export async function probeBaseUrl(
  adapter: string,
  baseUrl: string,
  deps: CdnAdapterDeps,
  details: Record<string, unknown> = {},
): Promise<CdnAdapterHealth> {
  const doFetch = resolveFetch(deps);
  try {
    const response = await doFetch(baseUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_CDN_TIMEOUT_MS),
    });
    const status: CdnAdapterHealth['status'] =
      response.status < 400 ? 'healthy' : response.status < 500 ? 'degraded' : 'unhealthy';
    return {
      status,
      adapter,
      baseUrl,
      lastCheck: new Date(),
      details: { ...details, httpStatus: response.status },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      adapter,
      baseUrl,
      lastCheck: new Date(),
      details: { ...details, error: errorText(error) },
    };
  }
}
