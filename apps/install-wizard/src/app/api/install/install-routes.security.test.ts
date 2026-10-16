/**
 * PRC-L400 — Route-handler security tests for the Install Wizard BFF.
 *
 * These drive the REAL route handlers (configure/[step], admin, finalize)
 * through the REAL {@link assertInstallSecurity} guard. The suite fails if the
 * guard is removed from any route: a request with no CSRF header must be
 * rejected with 403 before any business logic runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearInstallSessions,
  createInstallSession,
  finalizeSession,
  markStepComplete,
  BOOTSTRAP_STEPS,
  type InstallSession,
} from '@/lib/bootstrap-lock';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  INSTALL_TOKEN_COOKIE,
  INSTALL_TOKEN_HEADER,
} from '@/lib/install-security';

// Mutable cookie jar backing the mocked next/headers cookies().
let cookieJar: Map<string, string>;

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import { POST as configurePost } from './configure/[step]/route';
import { POST as adminPost } from './admin/route';
import { POST as finalizePost } from './finalize/route';

function headersFor(session: InstallSession, overrides: Record<string, string> = {}): Headers {
  const h = new Headers({
    'content-type': 'application/json',
    [CSRF_HEADER]: session.csrfToken,
    [INSTALL_TOKEN_HEADER]: session.installToken,
    ...overrides,
  });
  return h;
}

function jsonRequest(
  session: InstallSession,
  body: unknown,
  overrides: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/install', {
    method: 'POST',
    headers: headersFor(session, overrides),
    body: JSON.stringify(body),
  });
}

function primeCookies(session: InstallSession): void {
  cookieJar.set(CSRF_COOKIE, session.csrfToken);
  cookieJar.set(INSTALL_TOKEN_COOKIE, session.installToken);
}

describe('install BFF route security (PRC-L400)', () => {
  beforeEach(() => {
    cookieJar = new Map();
    clearInstallSessions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configure/[step]', () => {
    it('rejects a request with a missing CSRF header -> 403', async () => {
      const session = createInstallSession();
      primeCookies(session);
      const req = jsonRequest(
        session,
        { host: 'db', username: 'u', password: 'p', database: 'd' },
        { [CSRF_HEADER]: '' },
      );
      const res = await configurePost(req, { params: Promise.resolve({ step: 'database' }) });
      expect(res.status).toBe(403);
    });

    it('rejects a token/cookie mismatch -> 401', async () => {
      const session = createInstallSession();
      primeCookies(session);
      const req = jsonRequest(
        session,
        { host: 'db', username: 'u', password: 'p', database: 'd' },
        { [INSTALL_TOKEN_HEADER]: 'not-the-real-token' },
      );
      const res = await configurePost(req, { params: Promise.resolve({ step: 'database' }) });
      expect(res.status).toBe(401);
    });

    it('rejects an unknown step -> 404 (after passing security)', async () => {
      const session = createInstallSession();
      primeCookies(session);
      const req = jsonRequest(session, {});
      const res = await configurePost(req, { params: Promise.resolve({ step: 'bogus-step' }) });
      expect(res.status).toBe(404);
    });

    it('accepts a valid, authenticated first step -> 200', async () => {
      const session = createInstallSession();
      primeCookies(session);
      const req = jsonRequest(session, { host: 'db', username: 'u', password: 'p', database: 'd' });
      const res = await configurePost(req, { params: Promise.resolve({ step: 'database' }) });
      expect(res.status).toBe(200);
    });

    it('rejects configure once the session is locked -> 409', async () => {
      const session = createInstallSession();
      for (const step of BOOTSTRAP_STEPS) markStepComplete(session, step);
      finalizeSession(session);
      primeCookies(session);
      const req = jsonRequest(session, { host: 'db', username: 'u', password: 'p', database: 'd' });
      const res = await configurePost(req, { params: Promise.resolve({ step: 'database' }) });
      expect(res.status).toBe(409);
    });
  });

  describe('admin', () => {
    it('rejects a missing CSRF header -> 403', async () => {
      const session = createInstallSession();
      primeCookies(session);
      const req = jsonRequest(
        session,
        { email: 'a@b.c', password: 'pw', tenantSlug: 'acme' },
        { [CSRF_HEADER]: '' },
      );
      const res = await adminPost(req);
      expect(res.status).toBe(403);
    });

    it('rejects when the session is locked -> 409', async () => {
      const session = createInstallSession();
      for (const step of BOOTSTRAP_STEPS) markStepComplete(session, step);
      finalizeSession(session);
      primeCookies(session);
      const req = jsonRequest(session, { email: 'a@b.c', password: 'pw', tenantSlug: 'acme' });
      const res = await adminPost(req);
      expect(res.status).toBe(409);
    });

    it('accepts a valid authenticated admin payload -> 200', async () => {
      const session = createInstallSession();
      primeCookies(session);
      const req = jsonRequest(session, { email: 'a@b.c', password: 'pw', tenantSlug: 'acme' });
      const res = await adminPost(req);
      expect(res.status).toBe(200);
    });
  });

  describe('finalize', () => {
    it('rejects a missing install token header -> 401', async () => {
      const session = createInstallSession();
      primeCookies(session);
      const req = jsonRequest(session, {}, { [INSTALL_TOKEN_HEADER]: '' });
      const res = await finalizePost(req);
      expect(res.status).toBe(401);
    });

    it('rejects finalize before all steps are complete -> 400', async () => {
      const session = createInstallSession();
      primeCookies(session);
      const req = jsonRequest(session, {});
      const res = await finalizePost(req);
      expect(res.status).toBe(400);
    });

    it('finalizes a fully configured, authenticated session -> 200 then locks (409)', async () => {
      const session = createInstallSession();
      for (const step of BOOTSTRAP_STEPS) markStepComplete(session, step);
      primeCookies(session);
      const ok = await finalizePost(jsonRequest(session, {}));
      expect(ok.status).toBe(200);
      const again = await finalizePost(jsonRequest(session, {}));
      expect(again.status).toBe(409);
    });
  });
});
