/**
 * SSRF-safe fetch for tenant-controlled ETL connectors (PRC-C003).
 *
 * Tenant admins configure REST source/destination URLs. Without guarding, those URLs let a
 * tenant reach the host's own loopback services, the cloud metadata endpoint
 * (169.254.169.254), and other tenants' internal services from the shared process — a classic
 * SSRF. This module enforces, on every request AND on every redirect hop:
 *   - https only (no http/file/ftp/gopher/etc.);
 *   - DNS resolution up front, rejecting any address in a private / loopback / link-local /
 *     unique-local / metadata / reserved range;
 *   - manual redirect handling with a small hop cap (each hop re-validated);
 *   - a request timeout (AbortSignal);
 *   - a response body size cap.
 *
 * The guard fails closed: anything it cannot positively classify as a public, https target is
 * rejected.
 *
 * RESIDUAL RISK — this is resolve-and-check, not connection-level DNS pinning. The address is
 * validated here, then the request is issued by host name, so fetch() re-resolves independently.
 * A hostile resolver could return a public IP to this check and a private IP to the actual
 * connection (DNS rebinding / TOCTOU). Closing that fully requires connecting to the validated
 * IP (e.g. a custom undici agent) and is tracked as a follow-up; the checks above still block
 * the common literal-IP, http-scheme, and redirect vectors.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Overall request timeout in ms (default 15s). */
  timeoutMs?: number;
  /** Maximum redirect hops to follow (default 3). */
  maxRedirects?: number;
  /** Maximum response body size in bytes (default 25 MiB). */
  maxResponseBytes?: number;
  /** Injectable for tests: DNS resolver + fetch. */
  deps?: {
    resolveHost?: (host: string) => Promise<Array<{ address: string; family: number }>>;
    fetchImpl?: typeof fetch;
  };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

/**
 * Reject any IPv4/IPv6 literal that is not a routable public address.
 */
export function isDisallowedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map((p) => Number(p));
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this" network
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast + reserved (224.0.0.0/3)
    return false;
  }
  if (net.isIPv6(address)) {
    const addr = address.toLowerCase();
    if (addr === '::1' || addr === '::') return true; // loopback / unspecified
    if (addr.startsWith('fe80')) return true; // link-local
    if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique-local fc00::/7
    if (addr.startsWith('ff')) return true; // multicast
    // IPv4-mapped (::ffff:...) — reject the whole class. Node's URL emits the compressed
    // hextet form (::ffff:7f00:1) rather than dotted (::ffff:127.0.0.1), so we do not try to
    // parse the embedded v4; a public target should never be reached via a v4-mapped literal.
    if (addr.startsWith('::ffff:') || addr.startsWith('::')) return true;
    return false;
  }
  // Not a recognised IP literal — fail closed.
  return true;
}

/**
 * Validate a single URL: https scheme, resolvable host, and every resolved address public.
 * Returns the validated URL. Throws SsrfError otherwise.
 */
export async function assertPublicHttpsUrl(
  rawUrl: string,
  resolveHost: (host: string) => Promise<Array<{ address: string; family: number }>>,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'https:') {
    throw new SsrfError(`Only https URLs are allowed (got '${url.protocol}')`);
  }
  // url.hostname keeps brackets around IPv6 literals ([::1]); strip them so net.isIP and the
  // classifier see the bare address rather than treating it as an (unresolvable) name.
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  // A bare IP host is checked directly; a name is resolved and every address checked.
  if (net.isIP(host)) {
    if (isDisallowedAddress(host)) {
      throw new SsrfError(`URL host resolves to a disallowed address: ${host}`);
    }
    return url;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolveHost(host);
  } catch {
    throw new SsrfError(`Could not resolve host: ${host}`);
  }
  if (addresses.length === 0) {
    throw new SsrfError(`Host did not resolve to any address: ${host}`);
  }
  for (const { address } of addresses) {
    if (isDisallowedAddress(address)) {
      throw new SsrfError(`Host '${host}' resolves to a disallowed address: ${address}`);
    }
  }
  return url;
}

/**
 * Perform an SSRF-guarded fetch. Follows redirects manually, re-validating each hop.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const resolveHost = options.deps?.resolveHost ?? ((host: string) => lookup(host, { all: true }));
  const fetchImpl = options.deps?.fetchImpl ?? fetch;

  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await assertPublicHttpsUrl(currentUrl, resolveHost);

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new SsrfError(`Request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    // PRC-M226: the timeout stays armed until the body is fully read, so a server
    // that sends headers and then stalls cannot hang the run.
    try {
      const response = await fetchImpl(validated.toString(), {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
        redirect: 'manual',
        signal: controller.signal,
      });
      // Follow redirects ourselves so each Location is re-validated against the SSRF policy.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return await enforceResponseSize(response, maxResponseBytes, controller.signal);
        }
        if (hop === maxRedirects) {
          throw new SsrfError(`Too many redirects (> ${maxRedirects})`);
        }
        currentUrl = new URL(location, validated).toString();
        continue;
      }
      return await enforceResponseSize(response, maxResponseBytes, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable, but keeps the type checker satisfied.
  throw new SsrfError('Redirect handling exhausted');
}

/**
 * Reject a response whose declared or streamed size exceeds the cap.
 */
async function enforceResponseSize(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Response> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    throw new SsrfError(`Response body exceeds ${maxBytes} bytes (declared ${declared})`);
  }
  if (!response.body) {
    return response;
  }
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // PRC-M226: abort the body read when the request deadline fires.
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    const onAbort = () => {
      // Reject first: cancel() settles the pending read with done=true.
      reject(signal.reason ?? new SsrfError('Request aborted'));
      void reader.cancel().catch(() => undefined);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => undefined);
  for (;;) {
    const { done, value } = await Promise.race([reader.read(), aborted]);
    if (signal?.aborted) throw signal.reason ?? new SsrfError('Request aborted');
    if (done) break;
    if (value) {
      const chunk: Uint8Array = value;
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SsrfError(`Response body exceeds ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(merged, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
