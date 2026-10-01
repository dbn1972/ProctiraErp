/**
 * Credential redaction for ETL pipeline source/destination configs (PRC-H115).
 *
 * Pipeline GET/list/create/update responses previously returned database
 * passwords, REST auth config and auth headers verbatim to every ETL viewer.
 * Responses now replace secret values with {@link REDACTED_SECRET}. Clients
 * editing a pipeline may send the sentinel back unchanged; the service then
 * keeps the stored value instead of overwriting it with the placeholder.
 */

/** Placeholder returned in place of a stored secret, and accepted on update. */
export const REDACTED_SECRET = '__REDACTED__';

/** Top-level config keys whose values are always secrets. */
const SECRET_KEYS = new Set(['password', 'connectionString']);

/** Config keys whose values are string maps where every value is a secret. */
const SECRET_MAP_KEYS = new Set(['authConfig']);

/**
 * Config keys whose values are maps where every value is masked. PRC-H050 (defense in depth):
 * REST `headers` and request `body` may carry credentials under arbitrary names, so every
 * value is masked rather than only auth-looking header names.
 */
const MASK_ALL_VALUES_KEYS = new Set(['headers', 'body']);

type Config = Record<string, unknown>;

function isRecord(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns a copy of a source/destination config with secret values masked. */
export function redactConnectorSecrets<T>(config: T): T {
  if (!isRecord(config)) return config;
  const out: Config = { ...config };
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEYS.has(key) && typeof value === 'string' && value.length > 0) {
      out[key] = REDACTED_SECRET;
    } else if ((SECRET_MAP_KEYS.has(key) || MASK_ALL_VALUES_KEYS.has(key)) && isRecord(value)) {
      out[key] = Object.fromEntries(Object.keys(value).map((k) => [k, REDACTED_SECRET]));
    } else if (MASK_ALL_VALUES_KEYS.has(key) && value !== undefined && value !== null) {
      out[key] = REDACTED_SECRET;
    }
  }
  return out as T;
}

/**
 * Replaces {@link REDACTED_SECRET} placeholders in an incoming config with the
 * stored values from `existing`. Placeholders that have no stored counterpart
 * (e.g. connector type changed) are left in place so callers can reject them.
 */
export function restoreRedactedSecrets<T>(incoming: T, existing: unknown): T {
  if (!isRecord(incoming)) return incoming;
  // A stored credential is only restored when the connection target is
  // unchanged; otherwise an editor could repoint host/url and have the saved
  // secret sent to an endpoint of their choosing. Placeholders are then left
  // in place and the caller rejects them.
  const stored = isRecord(existing) && sameConnectionTarget(incoming, existing) ? existing : {};
  const out: Config = { ...incoming };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === REDACTED_SECRET && stored[key] !== undefined && stored[key] !== null) {
      out[key] = stored[key];
    } else if (isRecord(value)) {
      const storedMap = isRecord(stored[key]) ? stored[key] : {};
      out[key] = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          // body values may be non-string (PRC-H050 masks every body value).
          v === REDACTED_SECRET && storedMap[k] !== undefined ? storedMap[k] : v,
        ]),
      );
    }
  }
  return out as T;
}

/**
 * Config keys that identify where (and as whom) a credential is presented.
 * `url` is compared by origin so path/query edits on the same service keep
 * the saved secret.
 */
const TARGET_KEYS = ['type', 'host', 'port', 'database', 'username', 'authType', 'filePath'];

function urlOrigin(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

/** True when both configs point at the same connector target. */
export function sameConnectionTarget(incoming: Config, existing: Config): boolean {
  for (const key of TARGET_KEYS) {
    if (incoming[key] !== existing[key]) return false;
  }
  return urlOrigin(incoming['url']) === urlOrigin(existing['url']);
}

/** True when any value (shallow or one level deep) is still the placeholder. */
export function containsRedactedSecret(config: unknown): boolean {
  if (!isRecord(config)) return false;
  return Object.values(config).some(
    (value) =>
      value === REDACTED_SECRET ||
      (isRecord(value) && Object.values(value).some((v) => v === REDACTED_SECRET)),
  );
}
