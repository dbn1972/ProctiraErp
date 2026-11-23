/**
 * PRC-M467 — operator bootstrap secret + global, persisted install lock.
 *
 * Before the fix a session was issued to anyone (GET /session) and the "installed" lock lived
 * on the session object, so a fresh session after finalize could configure again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOOTSTRAP_STEPS,
  clearInstallSessions,
  createInstallSession,
  finalizeSession,
  markStepComplete,
  type InstallSession,
} from '@/lib/bootstrap-lock';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  INSTALL_TOKEN_COOKIE,
  INSTALL_TOKEN_HEADER,
} from '@/lib/install-security';

let cookieJar: Map<string, string>;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import { POST as adminPost } from './admin/route';
import { POST as configurePost } from './configure/[step]/route';
import { POST as finalizePost } from './finalize/route';
import { POST as sessionPost } from './session/route';

const SECRET = 'operator-bootstrap-secret-0001';

function sessionRequest(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set('x-install-bootstrap-secret', secret);
  return new Request('http://localhost/api/install/session', { method: 'POST', headers });
}

function authed(session: InstallSession, body: unknown): Request {
  cookieJar.set(CSRF_COOKIE, session.csrfToken);
  cookieJar.set(INSTALL_TOKEN_COOKIE, session.installToken);
  return new Request('http://localhost/api/install', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CSRF_HEADER]: session.csrfToken,
      [INSTALL_TOKEN_HEADER]: session.installToken,
    },
    body: JSON.stringify(body),
  });
}

const DB = { host: 'db', username: 'u', password: 'p', database: 'd' };

describe('PRC-M467 install session issuance requires the bootstrap secret', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    cookieJar = new Map();
    clearInstallSessions();
    process.env.INSTALL_BOOTSTRAP_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.INSTALL_BOOTSTRAP_SECRET = saved.INSTALL_BOOTSTRAP_SECRET;
    if (saved.INSTALL_BOOTSTRAP_SECRET === undefined) delete process.env.INSTALL_BOOTSTRAP_SECRET;
  });

  it('no secret header -> 401', async () => {
    expect((await sessionPost(sessionRequest())).status).toBe(401);
  });

  it('wrong secret -> 401', async () => {
    expect((await sessionPost(sessionRequest('operator-bootstrap-secret-0002'))).status).toBe(401);
  });

  it('secret not configured -> 503 (fail closed, never open)', async () => {
    delete process.env.INSTALL_BOOTSTRAP_SECRET;
    expect((await sessionPost(sessionRequest(SECRET))).status).toBe(503);
  });

  it('correct secret -> 200 with session tokens', async () => {
    const res = await sessionPost(sessionRequest(SECRET));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { csrfToken?: string; installToken?: string };
    expect(body.csrfToken).toBeTruthy();
    expect(body.installToken).toBeTruthy();
  });
});

describe('PRC-M467 the install lock is global, not per session', () => {
  beforeEach(() => {
    cookieJar = new Map();
    clearInstallSessions();
    process.env.INSTALL_BOOTSTRAP_SECRET = SECRET;
  });

  async function finalizeOnce(): Promise<void> {
    const a = createInstallSession();
    for (const step of BOOTSTRAP_STEPS) markStepComplete(a, step);
    const res = await finalizePost(authed(a, {}));
    expect(res.status).toBe(200);
  }

  it('a fresh session after finalize cannot configure, finalize or create the admin (409)', async () => {
    await finalizeOnce();
    const b = createInstallSession();
    const configure = await configurePost(authed(b, DB), {
      params: Promise.resolve({ step: 'database' }),
    });
    expect(configure.status).toBe(409);
    expect(
      (await adminPost(authed(b, { email: 'a@b.c', password: 'pw', tenantSlug: 'x' }))).status,
    ).toBe(409);
    for (const step of BOOTSTRAP_STEPS) markStepComplete(b, step);
    expect((await finalizePost(authed(b, {}))).status).toBe(409);
  });

  it('no new session is issued once installed (409)', async () => {
    await finalizeOnce();
    expect((await sessionPost(sessionRequest(SECRET))).status).toBe(409);
  });

  it('the lock survives a process restart (module reload)', async () => {
    await finalizeOnce();
    vi.resetModules();
    const reloaded = await import('@/lib/bootstrap-lock');
    expect(reloaded.isInstallLocked()).toBe(true);
    const fresh = reloaded.createInstallSession();
    const step = reloaded.markStepComplete(fresh, 'database');
    expect(step.ok).toBe(false);
    if (!step.ok) expect(step.status).toBe(409);
  });

  it('two sessions racing to finalize: exactly one wins', async () => {
    const a = createInstallSession();
    const b = createInstallSession();
    for (const step of BOOTSTRAP_STEPS) {
      markStepComplete(a, step);
      markStepComplete(b, step);
    }
    // The lock file is created with O_EXCL, so the loser sees the winner's file.
    const ra = finalizeSession(a);
    const rb = finalizeSession(b);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(false);
    if (!rb.ok) expect(rb.status).toBe(409);
  });

  it('production-like NODE_ENV without INSTALL_LOCK_FILE fails closed (503)', async () => {
    const savedEnv = process.env.NODE_ENV;
    const savedLock = process.env.INSTALL_LOCK_FILE;
    try {
      delete process.env.INSTALL_LOCK_FILE;
      (process.env as Record<string, string>).NODE_ENV = 'production';
      expect((await sessionPost(sessionRequest(SECRET))).status).toBe(503);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv;
      process.env.INSTALL_LOCK_FILE = savedLock;
    }
  });
});
