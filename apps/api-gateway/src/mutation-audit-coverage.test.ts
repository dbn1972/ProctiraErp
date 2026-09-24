/**
 * V15-16 — the post-hoc mutation-audit residual, measured against the real route table.
 *
 * `SEC_W1_SEC_10_COMPLETE.md` described this residual in prose: "other regulated mutations
 * (allergies, privacy, billing, student, scholarship, …)". Enumerating the routes the gateway
 * actually registers tells a sharper story — **166 of 170** security-sensitive mutating routes
 * are audited post-hoc, and 4 are atomic. The "…" was carrying almost the whole finding.
 *
 * These tests do not make anything atomic. They make the residual **bounded**:
 *
 *  1. a security-sensitive mutating route that is neither atomic nor explicitly waived fails
 *     the build, so the gap cannot grow by accident;
 *  2. a waiver that matches no route, or whose route count has drifted, also fails, so the
 *     list cannot rot into fiction after a refactor.
 *
 * (2) matters as much as (1). The error-code registry gate added in the same audit caught a
 * stale waiver I had written myself, which is the reason this one asserts counts rather than
 * mere presence.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  ATOMIC_MUTATION_AUDIT_PATH_PREFIXES,
  findStalePostHocWaivers,
  findUnaccountedSensitiveMutations,
  isAtomicMutationAuditPath,
  isPostHocAuditWaived,
  isSecuritySensitiveMutationPath,
  POST_HOC_MUTATION_AUDIT_WAIVERS,
  shouldAuditMutation,
} from './mutation-audit.js';

delete process.env['DATABASE_URL'];

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
      institutions: {
        prefix: '/institutions',
        target: 'http://localhost:3002',
        healthCheck: '/health',
      },
      students: { prefix: '/students', target: 'http://localhost:3003', healthCheck: '/health' },
    },
  };
}

describe('V15-16 post-hoc mutation-audit residual is bounded', () => {
  let app: FastifyInstance;
  let registered: { method: string; path: string }[];

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
    registered = (app.mutatingRouteAuthzRegistry?.getRegistered() ?? []).map((r) => ({
      method: r.method,
      path: r.path,
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('enumerates enough routes for the gate to mean anything', () => {
    // Guards against the gate passing vacuously if the registry stops being populated.
    expect(registered.length).toBeGreaterThan(400);
  });

  it('every security-sensitive mutating route is atomic or explicitly waived', () => {
    const unaccounted = findUnaccountedSensitiveMutations(registered);
    expect(
      unaccounted,
      unaccounted.length === 0
        ? ''
        : `These security-sensitive mutating routes have no audit decision. Either wire them ` +
            `into an atomic audit (ATOMIC_MUTATION_AUDIT_PATH_PREFIXES) or add an explicit ` +
            `entry to POST_HOC_MUTATION_AUDIT_WAIVERS with a reason:\n` +
            unaccounted.map((r) => `  ${r.method} ${r.path}`).join('\n'),
    ).toEqual([]);
  });

  it('no waiver is stale or has drifted in size', () => {
    const stale = findStalePostHocWaivers(registered);
    expect(
      stale,
      stale.length === 0
        ? ''
        : `POST_HOC_MUTATION_AUDIT_WAIVERS no longer matches the route table. Update the ` +
            `counts (and shrink the list if routes became atomic):\n` +
            stale.map((s) => `  ${s.prefix}: declared ${s.expected}, found ${s.actual}`).join('\n'),
    ).toEqual([]);
  });

  it('records the residual as a number, so a claim of progress has to move it', () => {
    const sensitive = registered
      .filter((r) => shouldAuditMutation(r.method, r.path))
      .filter((r) => isSecuritySensitiveMutationPath(r.path));
    const atomic = sensitive.filter((r) => isAtomicMutationAuditPath(r.path));
    const postHoc = sensitive.filter((r) => !isAtomicMutationAuditPath(r.path));

    // Not a ratchet on purpose: these are exact, so both making a route atomic and adding a
    // new sensitive route force a visible edit here rather than sliding under a threshold.
    expect({ sensitive: sensitive.length, atomic: atomic.length, postHoc: postHoc.length }).toEqual(
      { sensitive: 170, atomic: 4, postHoc: 166 },
    );

    // Every post-hoc route is covered by the waiver list — the same property as the gate
    // above, asserted from the other direction so a bug in one filter cannot hide it.
    expect(postHoc.every((r) => isPostHocAuditWaived(r.path))).toBe(true);
  });

  it('the atomic set is exactly the four routes claimed as COMPLETE', () => {
    const atomic = registered
      .filter((r) => shouldAuditMutation(r.method, r.path))
      .filter((r) => isAtomicMutationAuditPath(r.path))
      .map((r) => `${r.method} ${r.path}`)
      .sort();

    expect(atomic).toEqual([
      'DELETE /api/v1/health/measurements/:id',
      'POST /api/v1/fees/payments',
      'POST /api/v1/health/measurements',
      'PUT /api/v1/health/measurements/:id',
    ]);
    expect(ATOMIC_MUTATION_AUDIT_PATH_PREFIXES).toHaveLength(2);
  });

  it('a waiver prefix cannot silently cover a non-sensitive path', () => {
    // `isPostHocAuditWaived` is only consulted for sensitive paths, but if a future edit
    // reuses it more broadly, a prefix like `/api/v1/health` must not launder unrelated
    // routes into "accounted for".
    for (const waiver of POST_HOC_MUTATION_AUDIT_WAIVERS) {
      expect(
        isSecuritySensitiveMutationPath(waiver.prefix),
        `${waiver.prefix} is waived but is not security-sensitive — the waiver is misleading`,
      ).toBe(true);
    }
  });
});
