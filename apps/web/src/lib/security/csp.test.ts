/**
 * @vitest-environment node
 *
 * PRC-H024 / PRC-H033 — apps/web ships a nonce-based CSP: no 'unsafe-inline'
 * scripts, 'strict-dynamic' so Next.js chunk loading works, and the nonce is
 * forwarded to Next (request CSP header) and the root layout (x-nonce).
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { middleware } from '@/middleware';
import {
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  buildContentSecurityPolicy,
  cspFromEnv,
  generateNonce,
} from './csp';

function directive(policy: string, name: string): string[] {
  const entry = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return entry ? entry.split(/\s+/).slice(1) : [];
}

afterEach(() => vi.unstubAllEnvs());

describe('buildContentSecurityPolicy', () => {
  const nonce = 'AAAAAAAAAAAAAAAAAAAAAA==';

  it('allows scripts only by nonce + strict-dynamic in production', () => {
    const policy = buildContentSecurityPolicy({ nonce, isDev: false });
    const scripts = directive(policy, 'script-src');
    expect(scripts).toEqual([`'nonce-${nonce}'`, "'strict-dynamic'"]);
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(directive(policy, 'object-src')).toEqual(["'none'"]);
    expect(directive(policy, 'base-uri')).toEqual(["'self'"]);
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(policy, 'worker-src')).toContain("'self'");
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it('keeps inline styles (React style attributes, SSR tenant theme)', () => {
    const policy = buildContentSecurityPolicy({ nonce, isDev: false });
    expect(directive(policy, 'style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('adds unsafe-eval and ws: only in development (Next dev/HMR)', () => {
    const policy = buildContentSecurityPolicy({ nonce, isDev: true });
    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(policy, 'connect-src')).toEqual(expect.arrayContaining(['ws:', "'self'"]));
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  it('adds normalised gateway origins and drops non-http entries', () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      isDev: false,
      connectSrc: ['https://api.example.edu/api/v1', 'javascript:alert(1)', "'unsafe-inline'"],
    });
    expect(directive(policy, 'connect-src')).toEqual(["'self'", 'https://api.example.edu']);
  });

  it('rejects a malformed nonce (header injection guard)', () => {
    expect(() => buildContentSecurityPolicy({ nonce: "x'; script-src *", isDev: false })).toThrow();
  });
});

describe('generateNonce', () => {
  it('returns a fresh 128-bit base64 value each call', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});

describe('cspFromEnv', () => {
  it('switches to report-only only when CSP_REPORT_ONLY=true', () => {
    const nonce = generateNonce();
    expect(cspFromEnv(nonce, { NODE_ENV: 'production' }).header).toBe(CSP_HEADER);
    expect(cspFromEnv(nonce, { NODE_ENV: 'production', CSP_REPORT_ONLY: 'true' }).header).toBe(
      CSP_REPORT_ONLY_HEADER,
    );
  });

  it('includes NEXT_PUBLIC_GATEWAY_URL and CSP_CONNECT_SRC in connect-src', () => {
    const { value } = cspFromEnv(generateNonce(), {
      NODE_ENV: 'production',
      NEXT_PUBLIC_GATEWAY_URL: 'https://gw.example.edu',
      CSP_CONNECT_SRC: 'https://otel.example.edu, https://cdn.example.edu',
    });
    expect(directive(value, 'connect-src')).toEqual([
      "'self'",
      'https://gw.example.edu',
      'https://otel.example.edu',
      'https://cdn.example.edu',
    ]);
  });
});

describe('middleware CSP wiring', () => {
  it('sets an enforced nonce CSP on page responses and forwards the same nonce to Next', async () => {
    const response = await middleware(new NextRequest('http://localhost:3001/login'));
    const policy = response.headers.get(CSP_HEADER);
    expect(policy).toBeTruthy();
    const nonceSource = directive(policy ?? '', 'script-src').find((v) => v.startsWith("'nonce-"));
    expect(nonceSource).toBeDefined();
    const nonce = nonceSource!.slice("'nonce-".length, -1);
    // NextResponse.next({ request: { headers } }) exposes overridden request headers this way.
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(directive(policy ?? '', 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('uses a different nonce per request', async () => {
    const a = await middleware(new NextRequest('http://localhost:3001/login'));
    const b = await middleware(new NextRequest('http://localhost:3001/login'));
    expect(a.headers.get('x-middleware-request-x-nonce')).not.toBe(
      b.headers.get('x-middleware-request-x-nonce'),
    );
  });
});
