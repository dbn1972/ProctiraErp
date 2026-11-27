/**
 * @vitest-environment node
 *
 * UATENV-D28: the e2e harness Keycloak session mode. With `E2E_SESSION_MODE=keycloak` the
 * session helpers must hand out tokens issued by the gateway password grant for the matching
 * users-file account, never a locally minted HS256 token, so the nightly specs can run against a
 * gateway that accepts Keycloak tokens only.
 *
 * The stub gateway runs in a child process: the harness requests tokens synchronously, which
 * blocks this process's event loop.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSignedJwt, setupGatewayTenantSession } from '../../e2e/fixtures/fake-session';
import { resetKeycloakSessionCache } from '../../e2e/fixtures/keycloak-session';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';

const STUB_GATEWAY = `
const http = require('node:http');
const calls = { password: [], refresh: [] };
let n = 0;
const ttl = Number(process.env.STUB_TTL || 300);
function token(user) {
  n += 1;
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b({ alg: 'RS256', typ: 'JWT', kid: 'stub' }) + '.' +
    b({ sub: user, iss: 'stub-keycloak', exp: Math.floor(Date.now() / 1000) + ttl, n }) + '.stubsig';
}
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/calls') return send(200, calls);
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === '/api/v1/auth/password') {
      calls.password.push(body.username);
      if (body.username === 'mfa@uat.test') return send(401, { status: 'mfa_required' });
      if (body.password !== 'pw:' + body.username) return send(401, { code: 'INVALID_CREDENTIALS' });
      return send(200, { accessToken: token(body.username), refreshToken: 'rt:' + body.username, expiresIn: ttl });
    }
    if (req.url === '/api/v1/auth/refresh') {
      calls.refresh.push(body.refreshToken);
      const user = String(body.refreshToken).replace(/^rt:/, '');
      return send(200, { accessToken: token(user), refreshToken: 'rt:' + user, expiresIn: ttl });
    }
    send(404, {});
  });
});
server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
`;

const USERS = [
  ['username', 'role', 'tenant_slug', 'login_host', 'password'],
  ['sunrise-admin@uat.test', 'admin', 'sunrise', 'http://x', 'pw:sunrise-admin@uat.test'],
  ['sunrise-super@uat.test', 'super-admin', 'sunrise', 'http://x', 'pw:sunrise-super@uat.test'],
  ['sunrise-parent@uat.test', 'guardian', 'sunrise', 'http://x', 'pw:sunrise-parent@uat.test'],
  ['b-admin@uat.test', 'admin', 'e2e-tenant-a', 'http://x', 'pw:b-admin@uat.test'],
  ['b-teacher@uat.test', 'teacher', 'e2e-tenant-a', 'http://x', 'wrong-password'],
  ['mfa@uat.test', 'principal', 'e2e-tenant-a', 'http://x', 'pw:mfa@uat.test'],
];

function decode(token: string): { header: Record<string, unknown>; body: Record<string, unknown> } {
  const [h = '', b = ''] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    body: JSON.parse(Buffer.from(b, 'base64url').toString('utf8')),
  };
}

function startStub(ttl: number): Promise<{ proc: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['-e', STUB_GATEWAY], {
      env: { ...process.env, STUB_TTL: String(ttl) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    proc.once('error', reject);
    proc.stdout?.once('data', (chunk: Buffer) => {
      resolve({ proc, url: `http://127.0.0.1:${chunk.toString().trim()}` });
    });
  });
}

describe('e2e harness Keycloak session mode (UATENV-D28)', () => {
  let dir: string;
  let usersFile: string;
  let stub: { proc: ChildProcess; url: string };
  let shortStub: { proc: ChildProcess; url: string };
  const saved = { ...process.env };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kc-session-'));
    usersFile = join(dir, 'users.tsv');
    writeFileSync(usersFile, `${USERS.map((r) => r.join('\t')).join('\n')}\n`);
    chmodSync(usersFile, 0o600);
    stub = await startStub(300);
    shortStub = await startStub(5);
  });

  afterAll(() => {
    stub?.proc.kill();
    shortStub?.proc.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetKeycloakSessionCache();
    process.env.E2E_SESSION_MODE = 'keycloak';
    process.env.E2E_KEYCLOAK_USERS_FILE = usersFile;
    process.env.E2E_KEYCLOAK_TENANT_IDS = `sunrise=${SUNRISE},e2e-tenant-a=${TENANT_A}`;
    process.env.E2E_GATEWAY_URL = stub.url;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  async function calls(url = stub.url): Promise<{ password: string[]; refresh: string[] }> {
    return (await fetch(`${url}/calls`)).json() as Promise<{
      password: string[];
      refresh: string[];
    }>;
  }

  it('returns the gateway-issued Keycloak token instead of an HS256 token', () => {
    const token = createSignedJwt({
      sub: 'e2e-user',
      tenantId: SUNRISE,
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
    });
    const { header, body } = decode(token);
    expect(header.alg).toBe('RS256');
    expect(body.iss).toBe('stub-keycloak');
    expect(body.sub).toBe('sunrise-admin@uat.test');
  });

  it('picks the user by tenant and role, with lower-or-equal privilege aliases only', () => {
    const superSunrise = createSignedJwt({
      tenantId: SUNRISE,
      roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    });
    expect(decode(superSunrise).body.sub).toBe('sunrise-super@uat.test');
    // e2e-tenant-a has no super-admin account: SUPER_ADMIN falls back to its admin.
    const superTenantA = createSignedJwt({
      tenantId: TENANT_A,
      roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    });
    expect(decode(superTenantA).body.sub).toBe('b-admin@uat.test');
    const parent = createSignedJwt({
      tenantId: SUNRISE,
      roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
    });
    expect(decode(parent).body.sub).toBe('sunrise-parent@uat.test');
  });

  it('fails with a harness error, not a borrowed account, when no user matches', () => {
    expect(() =>
      createSignedJwt({
        tenantId: TENANT_A,
        roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
      }),
    ).toThrow(/no user in E2E_KEYCLOAK_USERS_FILE for tenant .*0001 and roles \[parent\]/);
  });

  it('reports a rejected sign-in or MFA challenge without the password', () => {
    const teacher = () =>
      createSignedJwt({
        tenantId: TENANT_A,
        roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: null }],
      });
    expect(teacher).toThrow(/b-teacher@uat\.test failed \(status 401, INVALID_CREDENTIALS\)/);
    expect(teacher).not.toThrow(/wrong-password/);
    expect(() =>
      createSignedJwt({
        tenantId: TENANT_A,
        roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
      }),
    ).toThrow(/status 401, mfa_required/);
  });

  it('re-uses a live token and refreshes one that is about to expire', async () => {
    const request = {
      tenantId: SUNRISE,
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
    };
    const before = await calls();
    const first = createSignedJwt(request);
    expect(createSignedJwt(request)).toBe(first);
    const after = await calls();
    expect(after.password.slice(before.password.length)).toEqual(['sunrise-admin@uat.test']);
    expect(after.refresh.length).toBe(before.refresh.length);

    resetKeycloakSessionCache();
    process.env.E2E_GATEWAY_URL = shortStub.url;
    const short = createSignedJwt(request);
    const refreshed = createSignedJwt(request);
    expect(refreshed).not.toBe(short);
    const seen = await calls(shortStub.url);
    expect(seen.password).toEqual(['sunrise-admin@uat.test']);
    expect(seen.refresh).toEqual(['rt:sunrise-admin@uat.test']);
  });

  it('puts the real access and refresh tokens in the browser session cookies', async () => {
    process.env.PLAYWRIGHT_BASE_URL = 'http://localhost:29080';
    const added: Array<{ name: string; value: string; url?: string }> = [];
    const page = {
      context: () => ({
        addCookies: async (cookies: typeof added) => {
          added.push(...cookies);
        },
      }),
    } as unknown as Parameters<typeof setupGatewayTenantSession>[0];
    await setupGatewayTenantSession(page, { tenantId: SUNRISE });
    const access = added.find((c) => c.name === 'access_token');
    expect(access && decode(access.value).body.sub).toBe('sunrise-super@uat.test');
    expect(added.find((c) => c.name === 'refresh_token')?.value).toBe('rt:sunrise-super@uat.test');
    expect(added.every((c) => c.url === 'http://localhost:29080')).toBe(true);
  });

  it('refuses a users file that other accounts can read', () => {
    const loose = join(dir, 'loose.tsv');
    writeFileSync(loose, `${USERS.map((r) => r.join('\t')).join('\n')}\n`);
    chmodSync(loose, 0o644);
    process.env.E2E_KEYCLOAK_USERS_FILE = loose;
    expect(() =>
      createSignedJwt({ tenantId: SUNRISE, roles: [{ roleId: 'admin', roleName: 'admin' }] }),
    ).toThrow(/must not be group\/world readable/);
  });

  it('keeps minting HS256 tokens when the mode is off', () => {
    delete process.env.E2E_SESSION_MODE;
    const { header, body } = decode(
      createSignedJwt({ sub: 'e2e-user', tenantId: TENANT_A, roles: [] }),
    );
    expect(header.alg).toBe('HS256');
    expect(body.sub).toBe('e2e-user');
  });
});
