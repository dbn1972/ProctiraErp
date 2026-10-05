/**
 * PRC-M109 — server-managed destination connections.
 *
 * Pipelines reference a destination by `connectionId`; host/credentials live
 * only in server configuration (`ETL_DESTINATION_CONNECTIONS`, a JSON object
 * keyed by id) and never travel through the web tier or the pipeline record.
 *
 *   ETL_DESTINATION_CONNECTIONS='{"warehouse":{"label":"Data warehouse",
 *     "type":"postgresql","host":"…","port":5432,"database":"…",
 *     "username":"…","password":"…"}}'
 */
import type { PostgresDestinationConfig } from '../schemas.js';

export interface DestinationConnectionSummary {
  id: string;
  label: string;
  type: 'postgresql';
}

interface StoredConnection {
  label?: string;
  type?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  schema?: string;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function readRegistry(env: NodeJS.ProcessEnv = process.env): Map<string, StoredConnection> {
  const raw = env.ETL_DESTINATION_CONNECTIONS;
  const out = new Map<string, StoredConnection>();
  if (!raw || !raw.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Misconfiguration fails closed: no connections are offered.
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!ID_RE.test(id) || !value || typeof value !== 'object') continue;
    const conn = value as StoredConnection;
    if (conn.type !== 'postgresql' || !conn.host || !conn.database || !conn.username) continue;
    out.set(id, conn);
  }
  return out;
}

/** Ids and labels only — never hosts or credentials. */
export function listDestinationConnections(
  env: NodeJS.ProcessEnv = process.env,
): DestinationConnectionSummary[] {
  return [...readRegistry(env).entries()].map(([id, conn]) => ({
    id,
    label: conn.label?.trim() || id,
    type: 'postgresql',
  }));
}

/** Resolve a connection reference into a concrete destination, or null if unknown. */
export function resolveDestinationConnection(
  ref: {
    connectionId: string;
    table: string;
    schema?: string;
    writeMode?: PostgresDestinationConfig['writeMode'];
  },
  env: NodeJS.ProcessEnv = process.env,
): PostgresDestinationConfig | null {
  const conn = readRegistry(env).get(ref.connectionId);
  if (!conn) return null;
  return {
    type: 'postgresql',
    host: conn.host!,
    port: conn.port ?? 5432,
    database: conn.database!,
    username: conn.username!,
    password: conn.password ?? '',
    schema: ref.schema ?? conn.schema,
    table: ref.table,
    writeMode: ref.writeMode,
  };
}
