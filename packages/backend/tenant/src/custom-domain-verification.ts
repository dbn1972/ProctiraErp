/**
 * PRC-L169: custom-domain ownership verification (topic 4, Option A: "custom domains need a
 * DNS/HTTP challenge").
 *
 * - Challenge: a per (tenant, domain) token of 32 random bytes, base64url (256-bit), stored on
 *   the domain document when the domain is added (or lazily for legacy rows).
 * - Proof (either):
 *     DNS TXT  `_proctira-verify.<domain>` whose value equals the token, or
 *     HTTPS    `GET https://<domain>/.well-known/proctira-verify/<token>` through the SSRF-safe
 *              fetch with redirects DISABLED; passes only on status 200 with a body of at most
 *              1 KiB whose trimmed text equals the token exactly.
 * - A successful proof verifies the hostname exclusively (`verifyDomainExclusive`) for 30 days.
 * - A re-check ticker (DR4-8) claims at most 50 due domains in one short transaction guarded by a
 *   transaction-scoped advisory lock, commits, runs the network checks outside any transaction,
 *   and writes each result in its own short transaction.
 */
import { randomBytes } from 'node:crypto';
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';

import { safeFetch, type SafeFetchOptions } from '@proctira/common/safe-fetch';

import { invalidatePublicHostCaches } from './public-tenant-resolver.js';
import type { DomainEntity, TenantRepository } from './tenant-repository.js';

/** Verification lifetime before a re-check must extend it. */
export const DOMAIN_VERIFICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Domains verified (or last checked) longer ago than this are re-checked. */
export const DOMAIN_RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** A claim older than this is considered abandoned (crashed tick) and may be re-claimed. */
export const DOMAIN_RECHECK_CLAIM_LEASE_MS = 10 * 60 * 1000;
/** Default re-check interval (`TENANT_DOMAIN_RECHECK_INTERVAL_MS`). */
export const DEFAULT_DOMAIN_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Maximum domains claimed per tick. */
export const DOMAIN_RECHECK_BATCH_LIMIT = 50;
/** Per network check time box. */
export const DOMAIN_PROOF_TIMEOUT_MS = 5_000;
/** Maximum HTTPS proof body. */
export const DOMAIN_PROOF_MAX_BODY_BYTES = 1024;
/** Advisory-lock keys (hashed with `hashtext` in SQL). */
export const DOMAIN_RECHECK_LOCK_KEY = 'tenant.domains:recheck';
export const domainHostLockKey = (hostname: string) => `tenant.domains:${hostname.toLowerCase()}`;

export const DNS_CHALLENGE_PREFIX = '_proctira-verify.';
export const HTTPS_CHALLENGE_PATH = '/.well-known/proctira-verify/';

/** 32 random bytes, base64url (256-bit). */
export function generateDomainVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function dnsChallengeName(domain: string): string {
  return `${DNS_CHALLENGE_PREFIX}${domain.toLowerCase()}`;
}

export function httpsChallengeUrl(domain: string, token: string): string {
  return `https://${domain.toLowerCase()}${HTTPS_CHALLENGE_PATH}${token}`;
}

/** Proof of control over a hostname. */
export interface DomainProofChecker {
  check(domain: string, token: string): Promise<boolean>;
}

export interface DomainProofCheckerOptions {
  resolveTxt?: (name: string) => Promise<string[][]>;
  /** Passed to the SSRF-safe fetch (tests inject resolver + fetch). */
  fetchDeps?: SafeFetchOptions['deps'];
  timeoutMs?: number;
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

/** DNS TXT then HTTPS well-known proof. Any error is "not proven" (fail closed). */
export function createDomainProofChecker(
  options: DomainProofCheckerOptions = {},
): DomainProofChecker {
  const resolveTxt = options.resolveTxt ?? ((name: string) => dnsResolveTxt(name));
  const timeoutMs = options.timeoutMs ?? DOMAIN_PROOF_TIMEOUT_MS;

  const dnsProof = async (domain: string, token: string): Promise<boolean> => {
    try {
      const records = await withTimeout(resolveTxt(dnsChallengeName(domain)), timeoutMs);
      return records.some((chunks) => chunks.join('') === token);
    } catch {
      return false;
    }
  };

  const httpsProof = async (domain: string, token: string): Promise<boolean> => {
    try {
      const response = await safeFetch(httpsChallengeUrl(domain, token), {
        method: 'GET',
        maxRedirects: 0,
        timeoutMs,
        maxResponseBytes: DOMAIN_PROOF_MAX_BODY_BYTES,
        deps: options.fetchDeps,
      });
      if (response.status !== 200) return false;
      const body = await response.text();
      return body.trim() === token;
    } catch {
      return false;
    }
  };

  return {
    async check(domain, token) {
      if (!token) return false;
      if (await dnsProof(domain, token)) return true;
      return httpsProof(domain, token);
    },
  };
}

/** True when a domain row currently counts as verified. */
export function isDomainVerificationCurrent(domain: DomainEntity, now: Date): boolean {
  if (!domain.verified) return false;
  const expires = domain.verificationExpiresAt ? new Date(domain.verificationExpiresAt) : null;
  return Boolean(expires && !Number.isNaN(expires.getTime()) && expires.getTime() > now.getTime());
}

export type VerifyDomainExclusiveResult =
  { status: 'verified'; domain: DomainEntity } | { status: 'conflict' } | { status: 'not_found' };

/** Repository operations used by verification and re-checks. */
export type DomainVerificationRepository = Pick<
  TenantRepository,
  'verifyDomainExclusive' | 'claimDomainsForRecheck' | 'recordDomainRecheck'
>;

export interface DomainRecheckTickResult {
  /** False when another replica held the recheck lock (tick skipped). */
  ran: boolean;
  checked: number;
  passed: number;
  failed: number;
}

/**
 * One re-check tick (DR4-8): claim (short txn + advisory xact lock) -> network checks outside any
 * transaction -> one short write per result.
 */
export async function runDomainRecheckTick(params: {
  repository: DomainVerificationRepository;
  checker: DomainProofChecker;
  now?: () => Date;
  limit?: number;
  /** Test seam: invoked while the claim transaction holds the advisory lock. */
  onLocked?: () => Promise<void>;
}): Promise<DomainRecheckTickResult> {
  const { repository, checker } = params;
  const now = params.now ?? (() => new Date());
  if (!repository.claimDomainsForRecheck || !repository.recordDomainRecheck) {
    return { ran: false, checked: 0, passed: 0, failed: 0 };
  }
  const claimed = await repository.claimDomainsForRecheck({
    now: now(),
    recheckBefore: new Date(now().getTime() - DOMAIN_RECHECK_AFTER_MS),
    claimLeaseBefore: new Date(now().getTime() - DOMAIN_RECHECK_CLAIM_LEASE_MS),
    limit: params.limit ?? DOMAIN_RECHECK_BATCH_LIMIT,
    onLocked: params.onLocked,
  });
  if (claimed === null) return { ran: false, checked: 0, passed: 0, failed: 0 };
  let passed = 0;
  let failed = 0;
  for (const domain of claimed) {
    const ok = domain.verificationToken
      ? await checker.check(domain.domain, domain.verificationToken)
      : false;
    await repository.recordDomainRecheck(domain.id, {
      passed: ok,
      now: now(),
      verificationExpiresAt: new Date(now().getTime() + DOMAIN_VERIFICATION_TTL_MS),
    });
    invalidatePublicHostCaches(domain.domain);
    if (ok) passed += 1;
    else failed += 1;
  }
  return { ran: true, checked: claimed.length, passed, failed };
}

/** Starts the unref'd re-check interval; returns a stop function. */
export function startDomainRecheckTicker(params: {
  repository: DomainVerificationRepository;
  checker: DomainProofChecker;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): () => void {
  const intervalMs = params.intervalMs ?? DEFAULT_DOMAIN_RECHECK_INTERVAL_MS;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDomainRecheckTick({ repository: params.repository, checker: params.checker })
      .catch((error: unknown) => params.onError?.(error))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
