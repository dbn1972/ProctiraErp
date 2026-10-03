/**
 * PRC-H115: map the builder's single "connection string / URL" input onto the
 * ETL API connector schema (packages/backend/etl/src/schemas.ts):
 *   - postgresql → host, port, database, username, password
 *   - rest_api   → url
 *   - csv/excel  → filePath
 *
 * Stored credentials are never loaded into the browser. When editing with a
 * blank input, the saved connection target is sent back unchanged with the
 * redaction placeholder as the password, so the API restores the stored
 * secret (it only restores when the target is unchanged).
 */

/** Mirrors REDACTED_SECRET in packages/backend/etl/src/secret-redaction.ts. */
export const REDACTED_SECRET = '__REDACTED__';

export type ConnectorConfig = Record<string, unknown> & { type: string };

/** Non-secret connection target of a loaded connector plus whether a secret is stored. */
export interface SavedConnectorTarget {
  type: string;
  target: Record<string, unknown>;
  hasSecret: boolean;
}

const PG_TARGET_KEYS = ['host', 'port', 'database', 'username', 'schema'] as const;

/** Extracts the saved (non-secret) target from an API connector response. */
export function savedTargetFrom(config: Record<string, unknown> | undefined): SavedConnectorTarget {
  if (!config) return { type: '', target: {}, hasSecret: false };
  const type = String(config['type'] ?? '');
  if (type === 'postgresql') {
    const target: Record<string, unknown> = {};
    for (const key of PG_TARGET_KEYS) {
      if (config[key] !== undefined) target[key] = config[key];
    }
    return { type, target, hasSecret: typeof config['password'] === 'string' && config['password'] !== '' };
  }
  if (type === 'rest_api') {
    return { type, target: config['url'] ? { url: config['url'] } : {}, hasSecret: false };
  }
  return { type, target: config['filePath'] ? { filePath: config['filePath'] } : {}, hasSecret: false };
}

/** Human-readable saved target (never includes a secret). */
export function describeSavedTarget(type: string, saved: SavedConnectorTarget): string | null {
  const t = saved.target;
  if (type === 'postgresql' && t['host']) {
    return `${String(t['username'] ?? '')}@${String(t['host'])}:${String(t['port'] ?? 5432)}/${String(t['database'] ?? '')}`;
  }
  if (t['url']) return String(t['url']);
  if (t['filePath']) return String(t['filePath']);
  return null;
}

export class ConnectionStringError extends Error {}

function parsePostgresUrl(raw: string): Record<string, unknown> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectionStringError('Enter a PostgreSQL URL like postgresql://user:pass@host:5432/db');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new ConnectionStringError('PostgreSQL URL must start with postgresql://');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !url.username || !url.password || !database) {
    throw new ConnectionStringError('PostgreSQL URL needs user, password, host and database');
  }
  const schema = url.searchParams.get('schema');
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...(schema ? { schema } : {}),
  };
}

/**
 * Builds the API connector body from the form's `connectionString` input and
 * extra fields (query/table). `saved` is set only when editing.
 */
export function toApiConnector(
  form: { type: string; connectionString: string } & Record<string, unknown>,
  saved?: SavedConnectorTarget,
): ConnectorConfig {
  const { connectionString, ...rest } = form;
  const input = connectionString.trim();
  if (!input) {
    if (!saved || saved.type !== form.type) return { ...rest, type: form.type };
    const keep: ConnectorConfig = { ...rest, ...saved.target, type: form.type };
    if (form.type === 'postgresql' && saved.hasSecret) keep['password'] = REDACTED_SECRET;
    return keep;
  }
  if (form.type === 'postgresql') return { ...rest, ...parsePostgresUrl(input), type: form.type };
  if (form.type === 'rest_api') return { ...rest, url: input, type: form.type };
  return { ...rest, filePath: input, type: form.type };
}
