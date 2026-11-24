/**
 * PRC-M589 — replica-safe pending external-login state.
 *
 * OAuth2 / OIDC providers used to keep `state -> {tenant, nonce, verifier}` in
 * a process-local Map, so a callback served by another replica (or after a
 * restart) failed. The state now lives in a {@link PendingAuthStateStore}
 * (Redis in deployed environments, process memory only for development/test).
 */
import { isDeployedEnvironment } from '@proctira/common/node-env';

import { MemoryWebTicketStore } from '../keycloak/routes.js';

import type { AssertionReplayStore, PendingAuthStateStore } from './types.js';

/** Pending external logins expire after 10 minutes (unchanged from the Map TTL). */
export const PENDING_AUTH_STATE_TTL_SECONDS = 600;

/** Key under which a provider's pending state is stored. */
export function pendingAuthStateKey(providerId: string, state: string): string {
  return `ext-auth:${providerId}:${state}`;
}

/**
 * Return the injected store, or a process-local one outside deployed
 * environments. A deployed process without a shared store refuses to start the
 * provider (fail closed) instead of failing every cross-replica callback.
 */
export function resolvePendingAuthStateStore(
  store: PendingAuthStateStore | undefined,
  context: string,
  processEnv: NodeJS.ProcessEnv = process.env,
): PendingAuthStateStore {
  if (store) return store;
  if (isDeployedEnvironment(processEnv['NODE_ENV'], processEnv)) {
    throw new Error(
      `${context} requires a shared (Redis) pending-login store in a deployed environment (PRC-M589)`,
    );
  }
  return new MemoryWebTicketStore();
}

/** Parse a stored pending-state JSON value; null when absent or malformed. */
export function parsePendingAuthState<T extends Record<string, unknown>>(
  raw: string | null,
  requiredStringKeys: ReadonlyArray<keyof T & string>,
): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    for (const key of requiredStringKeys) {
      if (typeof parsed[key] !== 'string') return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/** SAML Assertion IDs are remembered for 24 hours (unchanged from the Map TTL). */
export const SAML_ASSERTION_REPLAY_TTL_SECONDS = 24 * 60 * 60;

/** Process-local replay claims for development / test only. */
export class MemoryAssertionReplayStore implements AssertionReplayStore {
  private readonly claimed = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  claim(assertionId: string, ttlSeconds: number): Promise<boolean> {
    const now = this.now();
    for (const [id, expiresAt] of this.claimed) if (expiresAt <= now) this.claimed.delete(id);
    if (this.claimed.has(assertionId)) return Promise.resolve(false);
    this.claimed.set(assertionId, now + Math.max(1, Math.trunc(ttlSeconds)) * 1000);
    return Promise.resolve(true);
  }
}

/** Minimal ioredis surface for `SET key value EX ttl NX`. */
export interface RedisLikeForAssertionReplay {
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    condition: 'NX',
  ): Promise<string | null>;
}

/** Redis-backed replay cache: the first `SET NX` wins on every replica. */
export class RedisAssertionReplayStore implements AssertionReplayStore {
  constructor(
    private readonly redis: RedisLikeForAssertionReplay,
    private readonly keyPrefix = 'auth:saml-assertion:',
  ) {}
  async claim(assertionId: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(
      `${this.keyPrefix}${assertionId}`,
      '1',
      'EX',
      Math.max(1, Math.trunc(ttlSeconds)),
      'NX',
    );
    return result === 'OK';
  }
}

/** Injected replay store, or process memory outside deployed environments (fail closed). */
export function resolveAssertionReplayStore(
  store: AssertionReplayStore | undefined,
  context: string,
  processEnv: NodeJS.ProcessEnv = process.env,
): AssertionReplayStore {
  if (store) return store;
  if (isDeployedEnvironment(processEnv['NODE_ENV'], processEnv)) {
    throw new Error(
      `${context} requires a shared (Redis) SAML assertion replay store in a deployed environment (PRC-M589)`,
    );
  }
  return new MemoryAssertionReplayStore();
}
