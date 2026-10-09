/**
 * NEW-g7_platform-011 — plugin sandbox egress policy.
 *
 * The old sandbox network allow-list permitted the wildcard '*' and matched only on hostname, so
 * tenant-authored plugin code could reach any host — including the cloud metadata endpoint,
 * loopback and internal services (SSRF). This module makes the egress policy fail-closed:
 *   - a '*' wildcard in the allow-list is REJECTED (never "allow everything");
 *   - every outbound request is validated with the shared SSRF guard, which blocks non-https,
 *     private/loopback/link-local/metadata/CGNAT (incl. IPv6) targets and re-validates redirects;
 *   - the host must additionally be on the explicit allow-list.
 */
import { assertPublicHttpsUrlDefault, SsrfError } from '@proctira/common/safe-fetch';

export class SandboxEgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxEgressError';
  }
}

/**
 * Validate an egress allow-list. Throws if it contains the wildcard '*' (which would defeat the
 * allow-list) or an empty/blank entry. An empty list means "no network", which is allowed.
 */
export function assertSafeAllowedHosts(allowedHosts: readonly string[]): void {
  for (const host of allowedHosts) {
    const trimmed = host.trim();
    if (trimmed === '*' || trimmed === '') {
      throw new SandboxEgressError(
        "Sandbox network allow-list may not contain a wildcard ('*') or empty host",
      );
    }
  }
}

/**
 * Assert a single outbound request is permitted: the allow-list is well-formed and non-wildcard,
 * the host is explicitly listed, and the URL passes the shared SSRF guard (https + public IP).
 * Fail-closed: anything not positively allowed throws.
 */
export async function assertEgressAllowed(
  rawUrl: string,
  allowedHosts: readonly string[],
): Promise<void> {
  assertSafeAllowedHosts(allowedHosts);
  if (allowedHosts.length === 0) {
    throw new SandboxEgressError('Network access is not permitted for this plugin');
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SandboxEgressError(`Invalid URL: ${rawUrl}`);
  }
  if (!allowedHosts.includes(url.hostname)) {
    throw new SandboxEgressError(`Network access to host '${url.hostname}' is not permitted`);
  }
  // Shared SSRF guard: https-only + resolved public address (blocks metadata/loopback/private).
  try {
    await assertPublicHttpsUrlDefault(rawUrl);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw new SandboxEgressError(`Blocked by SSRF policy: ${err.message}`);
    }
    throw err;
  }
}
