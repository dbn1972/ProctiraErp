/**
 * PRC-L568: SSRF policy for operator-supplied adapter endpoints on the install HTTP surface.
 *
 * Every URL-typed adapter field (CDN base URL and invalidation endpoint, storage endpoint, SQS
 * endpoint, RabbitMQ URL) must:
 *   - use an allowed scheme (`https:`; `amqps:` for RabbitMQ) — no plaintext schemes;
 *   - carry no wildcard host;
 *   - resolve (DNS, up front) only to public addresses.
 *
 * Self-hosted installs often point at private infrastructure, so the operator may name exact
 * hosts in an explicit allow-list (`INSTALL_ENDPOINT_ALLOWED_HOSTS`, comma separated, no `*`).
 * An allow-listed host may resolve to a private range, but never to loopback, link-local, the
 * cloud metadata endpoint, "this" network or multicast — those stay blocked for every host.
 *
 * Name resolution is time-boxed; a resolution failure fails closed.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

import { isDisallowedAddress } from '@proctira/common/safe-fetch';

export type ResolveHost = (host: string) => Promise<Array<{ address: string; family: number }>>;

export interface EndpointPolicyOptions {
  /** DNS resolver (injectable for tests). Defaults to `dns.lookup(all)`. */
  resolveHost?: ResolveHost;
  /** Exact host names / IP literals the operator explicitly allows to be private. */
  allowedPrivateHosts?: readonly string[];
  /** DNS resolution timeout in ms (default 5000). */
  resolveTimeoutMs?: number;
}

export interface EndpointPolicy {
  /** Returns an error message, or null when the URL is acceptable. */
  check(rawUrl: string, allowedSchemes: readonly string[]): Promise<string | null>;
}

const DEFAULT_RESOLVE_TIMEOUT_MS = 5_000;

/** Parse the operator allow-list. A wildcard entry is a configuration error. */
export function parseAllowedEndpointHosts(raw: string | undefined): string[] {
  const hosts = (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  for (const host of hosts) {
    if (host.includes('*')) {
      throw new Error(
        `INSTALL_ENDPOINT_ALLOWED_HOSTS must list exact hosts; '${host}' is a wildcard`,
      );
    }
  }
  return hosts;
}

/** Addresses no endpoint may reach, allow-listed or not. */
export function isAlwaysBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map((p) => Number(p)) as [number, number];
    if (a === 127 || a === 0) return true; // loopback, "this" network
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(address)) {
    const addr = address.toLowerCase();
    if (addr === '::1' || addr === '::') return true;
    if (addr.startsWith('fe80')) return true;
    if (addr.startsWith('ff')) return true;
    if (addr.startsWith('::ffff:')) return true; // v4-mapped: may hide loopback/metadata
    return false;
  }
  return true;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createEndpointPolicy(options: EndpointPolicyOptions = {}): EndpointPolicy {
  const resolveHost: ResolveHost =
    options.resolveHost ?? ((host: string) => lookup(host, { all: true }));
  const allowed = new Set(
    (options.allowedPrivateHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  for (const host of allowed) {
    if (host.includes('*')) throw new Error(`Endpoint allow-list entry '${host}' is a wildcard`);
  }
  const timeoutMs = options.resolveTimeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;

  const addressRefusal = (host: string, address: string): string | null => {
    if (isAlwaysBlockedAddress(address)) {
      return `Endpoint host '${host}' resolves to a blocked address (${address})`;
    }
    if (!allowed.has(host) && isDisallowedAddress(address)) {
      return `Endpoint host '${host}' resolves to a private address (${address}); add it to INSTALL_ENDPOINT_ALLOWED_HOSTS to allow it explicitly`;
    }
    return null;
  };

  return {
    async check(rawUrl, allowedSchemes) {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return 'Endpoint is not a valid URL';
      }
      if (!allowedSchemes.includes(url.protocol)) {
        return `Endpoint scheme '${url.protocol}' is not allowed (allowed: ${allowedSchemes.join(', ')})`;
      }
      const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
      if (!host || host.includes('*')) return 'Endpoint host must be an exact host name';
      if (net.isIP(host)) return addressRefusal(host, host);
      let addresses: Array<{ address: string; family: number }>;
      try {
        addresses = await withTimeout(resolveHost(host), timeoutMs);
      } catch {
        return `Endpoint host '${host}' could not be resolved`;
      }
      if (addresses.length === 0) return `Endpoint host '${host}' did not resolve`;
      for (const { address } of addresses) {
        const refusal = addressRefusal(host, address);
        if (refusal) return refusal;
      }
      return null;
    },
  };
}
