import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * UATENV-D28: Keycloak session mode for the e2e harness.
 *
 * With `E2E_SESSION_MODE=keycloak` the session helpers in `fake-session.ts` stop minting HS256
 * tokens and sign in as a real realm user through the gateway password grant
 * (`POST /api/v1/auth/password`, the route the web login form uses). The gateway verifies these
 * tokens with its normal Keycloak JWKS check, so specs can run against a stack whose gateway
 * accepts Keycloak tokens only (the UAT stack). Nothing here changes gateway verification.
 *
 * The user is picked by the tenant and role the spec asks for, from the users file named by
 * `E2E_KEYCLOAK_USERS_FILE` (tab-separated, header `username role tenant_slug ... password`, the
 * format of the UAT `secrets/uat-users.tsv`). Tenant slugs map to tenant ids through an optional
 * `tenant_id` column or `E2E_KEYCLOAK_TENANT_IDS` (`slug=uuid,slug=uuid`). A spec role with no
 * matching user fails with a harness error instead of borrowing a more privileged account.
 * Credentials and tokens are never logged or put on a command line.
 */

export interface HarnessRole {
  roleId?: string;
  roleName?: string;
}

export interface KeycloakUser {
  username: string;
  role: string;
  tenantSlug: string;
  tenantId?: string;
}

export interface KeycloakSession {
  username: string;
  accessToken: string;
  refreshToken?: string;
}

interface UserRecord extends KeycloakUser {
  password: string;
}

interface CachedSession extends KeycloakSession {
  expiresAt: number;
}

interface CliResult {
  ok: boolean;
  status?: number;
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
}

/** Spec role names (normalised) to users-file roles, tried in order. Never a higher privilege. */
const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  super_admin: ['super_admin', 'admin'],
  administrator: ['admin'],
  parent: ['guardian'],
  health_officer: ['health_admin'],
};

/** Re-use a token until this many ms before it expires. */
const EXPIRY_MARGIN_MS = 30_000;

const CLI_PATH = fileURLToPath(new URL('./keycloak-token-cli.mjs', import.meta.url));

let usersCache: { file: string; users: UserRecord[] } | undefined;
const sessions = new Map<string, CachedSession>();

export function isKeycloakSessionMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.E2E_SESSION_MODE?.trim().toLowerCase() === 'keycloak';
}

export function normaliseRole(role: string): string {
  return role
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseTenantIds(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (raw ?? '').split(',')) {
    const [slug, id] = pair.split('=').map((part) => part.trim());
    if (slug && id) map.set(slug, id);
  }
  return map;
}

function loadUsers(env: NodeJS.ProcessEnv): UserRecord[] {
  const file = env.E2E_KEYCLOAK_USERS_FILE?.trim();
  if (!file) {
    throw new Error('E2E_SESSION_MODE=keycloak needs E2E_KEYCLOAK_USERS_FILE (users TSV path)');
  }
  if (usersCache?.file === file) return usersCache.users;
  // The file holds passwords: refuse one that other accounts can read.
  if ((statSync(file).mode & 0o077) !== 0) {
    throw new Error(`E2E_KEYCLOAK_USERS_FILE must not be group/world readable (chmod 600)`);
  }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = (lines[0] ?? '').split('\t').map((h) => h.trim());
  for (const column of ['username', 'role', 'tenant_slug', 'password']) {
    if (!header.includes(column)) {
      throw new Error(`E2E_KEYCLOAK_USERS_FILE header is missing the "${column}" column`);
    }
  }
  const tenantIds = parseTenantIds(env.E2E_KEYCLOAK_TENANT_IDS);
  const users = lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const col = (name: string): string => {
      const index = header.indexOf(name);
      return index < 0 ? '' : (cells[index] ?? '').trim();
    };
    const tenantSlug = col('tenant_slug');
    return {
      username: col('username'),
      password: col('password'),
      role: normaliseRole(col('role')),
      tenantSlug,
      tenantId: col('tenant_id') || tenantIds.get(tenantSlug),
    };
  });
  usersCache = { file, users };
  return users;
}

/**
 * The users-file account for a spec's tenant and roles. Roles are tried in the spec's order,
 * each with its aliases; the tenant must match exactly.
 */
export function selectKeycloakUser(
  request: { tenantId?: string; roles?: readonly HarnessRole[] },
  env: NodeJS.ProcessEnv = process.env,
): KeycloakUser {
  const users = loadUsers(env);
  const wanted = (request.roles ?? [])
    .map((r) => normaliseRole(r.roleName ?? r.roleId ?? ''))
    .filter(Boolean);
  for (const role of wanted) {
    for (const candidate of ROLE_ALIASES[role] ?? [role]) {
      const match = users.find(
        (u) => u.role === candidate && (!request.tenantId || u.tenantId === request.tenantId),
      );
      if (match) {
        return {
          username: match.username,
          role: match.role,
          tenantSlug: match.tenantSlug,
          tenantId: match.tenantId,
        };
      }
    }
  }
  throw new Error(
    `Keycloak session mode: no user in E2E_KEYCLOAK_USERS_FILE for tenant ${
      request.tenantId ?? '(any)'
    } and roles [${wanted.join(', ')}]`,
  );
}

function gatewayUrl(env: NodeJS.ProcessEnv): string {
  const url = env.E2E_GATEWAY_URL?.trim() || env.NEXT_PUBLIC_GATEWAY_URL?.trim();
  if (!url) throw new Error('E2E_SESSION_MODE=keycloak needs E2E_GATEWAY_URL');
  return url;
}

function runCli(input: Record<string, string>): CliResult {
  const out = execFileSync(process.execPath, [CLI_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout: 30_000,
  });
  return JSON.parse(out) as CliResult;
}

function expiryOf(result: CliResult): number {
  if (result.expiresIn) return Date.now() + result.expiresIn * 1000;
  try {
    const claims = JSON.parse(
      Buffer.from(result.accessToken?.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { exp?: number };
    if (typeof claims.exp === 'number') return claims.exp * 1000;
  } catch {
    // fall through
  }
  return Date.now() + 60_000;
}

/**
 * A live session for the user matching the spec's tenant and roles. Cached per worker process
 * until shortly before expiry, then refreshed through `POST /api/v1/auth/refresh`; a failed
 * refresh signs in again.
 */
export function keycloakSessionFor(
  request: { tenantId?: string; roles?: readonly HarnessRole[] },
  env: NodeJS.ProcessEnv = process.env,
): KeycloakSession {
  const user = selectKeycloakUser(request, env);
  const cached = sessions.get(user.username);
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached;
  const gateway = gatewayUrl(env);
  let result: CliResult | undefined;
  if (cached?.refreshToken) {
    result = runCli({ gatewayUrl: gateway, op: 'refresh', refreshToken: cached.refreshToken });
    if (!result.ok) result = undefined;
  }
  if (!result) {
    const record = loadUsers(env).find((u) => u.username === user.username);
    result = runCli({
      gatewayUrl: gateway,
      op: 'password',
      username: user.username,
      password: record?.password ?? '',
    });
  }
  if (!result.ok || !result.accessToken) {
    sessions.delete(user.username);
    throw new Error(
      `Keycloak session mode: sign-in for ${user.username} failed (status ${
        result.status ?? 0
      }, ${result.code ?? 'unknown'})`,
    );
  }
  const session: CachedSession = {
    username: user.username,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken ?? cached?.refreshToken,
    expiresAt: expiryOf(result),
  };
  sessions.set(user.username, session);
  return session;
}

/** Test-only: forget cached users and sessions. */
export function resetKeycloakSessionCache(): void {
  usersCache = undefined;
  sessions.clear();
}
