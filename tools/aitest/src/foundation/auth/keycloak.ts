/**
 * Keycloak role users for full-profile stacks (program plan D8, section 4.3
 * step 8): a TypeScript port of tools/scripts/uatenv/uatenv-keycloak.sh.
 *
 * The realm is the base compose import of infra/keycloak/proctira-realm.json.
 * This module rotates the proctira-gateway client secret (the committed dev
 * secret is never used), lets admins set the tenant_id / tenant_slug
 * attributes, and creates one user per UAT_ROLE_USERS row. Generated
 * passwords live in <projectDir>/keycloak-users.tsv (mode 600); admin
 * credentials and passwords travel only in request bodies.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { TENANTS } from '../seed/tenants.js';
import { readEnvFile } from '../stack/secrets.js';
import { stackSecrets } from '../stack/state.js';
import type { StackState } from '../stack/types.js';

import { PLATFORM_TENANT, UAT_ROLE_USERS } from './roles.js';

export const KEYCLOAK_REALM = 'proctira';
export const KEYCLOAK_CLIENT_ID = 'proctira-gateway';
export const KEYCLOAK_USER_DOMAIN = 'proctira-aitest.test';

function kcBase(s: StackState): string {
  return `http://127.0.0.1:${s.ports.keycloak}`;
}

export function keycloakJwksUrl(s: StackState): string {
  return `${kcBase(s)}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`;
}

export function keycloakUsersFile(s: StackState): string {
  return join(s.projectDir, 'keycloak-users.tsv');
}

async function form(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `Keycloak token request failed: HTTP ${res.status} ${String(body['error'] ?? '')}`,
    );
  }
  return body;
}

async function adminToken(s: StackState): Promise<string> {
  const body = await form(`${kcBase(s)}/realms/master/protocol/openid-connect/token`, {
    grant_type: 'password',
    client_id: 'admin-cli',
    username: 'admin',
    password: stackSecrets(s).keycloakAdminPassword,
  });
  return String(body['access_token']);
}

class KcAdmin {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/admin/realms/${KEYCLOAK_REALM}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (res.status >= 400) {
      throw new Error(`Keycloak ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

function setEnvVar(file: string, key: string, value: string): void {
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith(`${key}=`));
  lines.push(`${key}=${value}`);
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}

interface UserRow {
  username: string;
  role: string;
  tenantSlug: string;
  tenantId: string;
  password: string;
}

function readUsers(file: string): UserRow[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((l) => {
      const [username = '', role = '', tenantSlug = '', tenantId = '', password = ''] =
        l.split('\t');
      return { username, role, tenantSlug, tenantId, password };
    });
}

/**
 * Rotates the gateway client secret into the stack env file
 * (KEYCLOAK_CLIENT_SECRET) and creates or updates one user per UAT role user.
 */
export async function ensureKeycloakUsers(
  s: StackState,
): Promise<Array<{ username: string; role: string; tenant: string }>> {
  const kc = new KcAdmin(kcBase(s), await adminToken(s));
  const realm = JSON.parse(
    readFileSync(join(s.repoRoot, 'infra/keycloak/proctira-realm.json'), 'utf8'),
  ) as { roles: { realm: Array<{ name: string }> } };
  for (const { name } of realm.roles.realm) {
    try {
      await kc.call('GET', `/roles/${encodeURIComponent(name)}`);
    } catch {
      await kc.call('POST', '/roles', { name, description: `aitest catalogue role ${name}` });
    }
  }
  const clients = await kc.call<Array<{ id: string }>>(
    'GET',
    `/clients?clientId=${KEYCLOAK_CLIENT_ID}`,
  );
  const cid = clients[0]?.id;
  if (!cid) throw new Error(`client ${KEYCLOAK_CLIENT_ID} not found in realm ${KEYCLOAK_REALM}`);
  if (!readEnvFile(s.envFile)['KEYCLOAK_CLIENT_SECRET']) {
    const rotated = await kc.call<{ value: string }>('POST', `/clients/${cid}/client-secret`);
    setEnvVar(s.envFile, 'KEYCLOAK_CLIENT_SECRET', rotated.value);
  }
  const profile = await kc.call<Record<string, unknown>>('GET', '/users/profile');
  await kc.call('PUT', '/users/profile', { ...profile, unmanagedAttributePolicy: 'ADMIN_EDIT' });

  const file = keycloakUsersFile(s);
  const existing = new Map(readUsers(file).map((u) => [u.username, u.password]));
  const rows: UserRow[] = [];
  for (const u of UAT_ROLE_USERS) {
    const username = `${u.usernamePrefix}@${KEYCLOAK_USER_DOMAIN}`;
    const tenantId = u.tenant === PLATFORM_TENANT ? PLATFORM_TENANT : TENANTS[u.tenant].id;
    const tenantSlug = u.tenant === PLATFORM_TENANT ? PLATFORM_TENANT : TENANTS[u.tenant].slug;
    const password = existing.get(username) ?? randomBytes(18).toString('base64url');
    const [first = 'User', ...rest] = u.displayName.split(' ');
    const rep = {
      username,
      email: username,
      emailVerified: true,
      enabled: true,
      firstName: `aitest ${first}`,
      lastName: rest.join(' ') || 'User',
      attributes: { tenant_id: [tenantId], tenant_slug: [tenantSlug] },
      requiredActions: [],
    };
    const found = await kc.call<Array<{ id: string }>>(
      'GET',
      `/users?username=${encodeURIComponent(username)}&exact=true`,
    );
    let uid = found[0]?.id;
    if (!uid) {
      await kc.call('POST', '/users', rep);
      uid = (
        await kc.call<Array<{ id: string }>>(
          'GET',
          `/users?username=${encodeURIComponent(username)}&exact=true`,
        )
      )[0]?.id;
      if (!uid) throw new Error(`could not create Keycloak user ${username}`);
    } else {
      await kc.call('PUT', `/users/${uid}`, rep);
    }
    await kc.call('PUT', `/users/${uid}/reset-password`, {
      type: 'password',
      value: password,
      temporary: false,
    });
    const role = await kc.call<Record<string, unknown>>(
      'GET',
      `/roles/${encodeURIComponent(u.role)}`,
    );
    await kc.call('POST', `/users/${uid}/role-mappings/realm`, [role]);
    rows.push({ username, role: u.role, tenantSlug, tenantId, password });
  }
  writeFileSync(
    file,
    `username\trole\ttenant_slug\ttenant_id\tpassword\n${rows
      .map((r) => [r.username, r.role, r.tenantSlug, r.tenantId, r.password].join('\t'))
      .join('\n')}\n`,
    { mode: 0o600 },
  );
  return rows.map((r) => ({ username: r.username, role: r.role, tenant: r.tenantSlug }));
}

/** Direct-grant (password) token for one aitest Keycloak user, through the gateway client. */
export async function keycloakPasswordGrant(
  s: StackState,
  username: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const full = username.includes('@') ? username : `${username}@${KEYCLOAK_USER_DOMAIN}`;
  const row = readUsers(keycloakUsersFile(s)).find((u) => u.username === full);
  if (!row) throw new Error(`no aitest Keycloak user ${full}: run ensureKeycloakUsers first`);
  const secret = readEnvFile(s.envFile)['KEYCLOAK_CLIENT_SECRET'];
  if (!secret) throw new Error('KEYCLOAK_CLIENT_SECRET missing from the stack env file');
  const body = await form(`${kcBase(s)}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    grant_type: 'password',
    client_id: KEYCLOAK_CLIENT_ID,
    client_secret: secret,
    username: full,
    password: row.password,
    scope: 'openid',
  });
  return {
    accessToken: String(body['access_token']),
    refreshToken: String(body['refresh_token']),
    expiresIn: Number(body['expires_in']),
  };
}

export function keycloakUsernames(): string[] {
  return UAT_ROLE_USERS.map((u) => `${u.usernamePrefix}@${KEYCLOAK_USER_DOMAIN}`);
}
