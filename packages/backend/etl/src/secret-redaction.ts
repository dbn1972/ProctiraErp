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

/** Header names treated as credentials (case-insensitive substring match). */
const SECRET_HEADER_PATTERNS = ['authorization', 'cookie', 'token', 'secret', 'api-key', 'apikey'];

function isSecretHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return SECRET_HEADER_PATTERNS.some((pattern) => lower.includes(pattern));
}

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
    } else if (SECRET_MAP_KEYS.has(key) && isRecord(value)) {
      out[key] = Object.fromEntries(Object.keys(value).map((k) => [k, REDACTED_SECRET]));
    } else if (key === 'headers' && isRecord(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, isSecretHeader(k) ? REDACTED_SECRET : v]),
      );
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
  const stored = isRecord(existing) && existing.type === incoming.type ? existing : {};
  const out: Config = { ...incoming };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === REDACTED_SECRET && typeof stored[key] === 'string') {
      out[key] = stored[key];
    } else if (isRecord(value)) {
      const storedMap = isRecord(stored[key]) ? stored[key] : {};
      out[key] = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          v === REDACTED_SECRET && typeof storedMap[k] === 'string' ? storedMap[k] : v,
        ]),
      );
    }
  }
  return out as T;
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
