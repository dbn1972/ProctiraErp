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

import type { PendingAuthStateStore } from './types.js';

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
