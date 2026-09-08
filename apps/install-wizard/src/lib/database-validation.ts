/**
 * Client-side database connection validation for Install Wizard Step 1.
 * Runs before the configure API call so operators see field errors locally.
 */

export interface DatabaseConfigInput {
  provider?: unknown;
  host?: unknown;
  port?: unknown;
  database?: unknown;
  username?: unknown;
  password?: unknown;
  poolSize?: unknown;
}

export interface DatabaseFieldErrors {
  provider?: string;
  host?: string;
  port?: string;
  database?: string;
  username?: string;
  password?: string;
  poolSize?: string;
}

const HOST_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$|^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-fA-F:]+\]?$/;
const DB_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Validate database connection fields. Returns field errors or null when valid.
 */
export function validateDatabaseConfig(input: DatabaseConfigInput): DatabaseFieldErrors | null {
  const provider = asString(input.provider).trim();
  const host = asString(input.host).trim();
  const database = asString(input.database).trim();
  const username = asString(input.username).trim();
  const password = asString(input.password);
  const port = asNumber(input.port);
  const poolSize = input.poolSize === undefined ? 10 : asNumber(input.poolSize);

  const errors: DatabaseFieldErrors = {};

  if (provider !== 'postgresql' && provider !== 'mysql') {
    errors.provider = 'Provider must be postgresql or mysql';
  }

  if (!host) errors.host = 'Host is required';
  else if (host.length > 253) errors.host = 'Host is too long';
  else if (!HOST_RE.test(host) && host !== 'localhost') {
    errors.host = 'Host must be a hostname or IP address';
  }

  if (port === null) errors.port = 'Port is required';
  else if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.port = 'Port must be an integer between 1 and 65535';
  }

  if (!database) errors.database = 'Database name is required';
  else if (!DB_NAME_RE.test(database)) {
    errors.database = 'Database name must be alphanumeric (underscore/hyphen allowed)';
  }

  if (!username) errors.username = 'Username is required';
  else if (username.length > 128) errors.username = 'Username is too long';

  if (!password) errors.password = 'Password is required';
  else if (password.length > 256) errors.password = 'Password is too long';

  if (poolSize === null) errors.poolSize = 'Pool size must be a number';
  else if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 100) {
    errors.poolSize = 'Pool size must be an integer between 1 and 100';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
