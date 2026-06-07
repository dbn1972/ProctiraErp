/**
 * Tenant Branding Preview Path — Integration Tests (Task 58.3)
 *
 * Exercises the preview cookie / header flow end-to-end through the
 * Fastify route layer using `app.inject()`. These tests cover the four
 * matrices described in tasks.md 58.3:
 *
 *   1. Anonymous request → published tokens (no preview consideration).
 *   2. Authenticated user WITHOUT `branding:preview` + cookie set →
 *      published tokens (the cookie alone must not unlock the draft).
 *   3. Authenticated user WITH `branding:preview` + cookie / header →
 *      draft tokens.
 *   4. Authenticated user WITH `branding:preview` but NO cookie / header
 *      → published tokens.
 *
 * The permission resolver is wired through the
 * `BrandingRoutesOptions.hasPermission` hook so the tests can simulate any
 * combination of caller identity and permissions without booting the full
 * auth/RBAC plugin stack.
 *
 * Validates: Requirement 28.5, Design §N.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { TenantService } from './tenant-service.js';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import { registerTenantRoutes } from './routes.js';
import {
  registerBrandingRoutes,
  PREVIEW_COOKIE_NAME,
  PREVIEW_HEADER_NAME,
  type BrandingPermissionResolver,
} from './branding-routes.js';
import type { CreateTenantInput, ThemeTokens } from './schemas.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PUBLISHER_ALICE = '11111111-1111-4111-8111-111111111111';
const EDITOR_BOB = '22222222-2222-4222-8222-222222222222';

const publishedTokens: ThemeTokens = {
  '--tenant-primary': 'hsl(222, 47%, 31%)',
  '--tenant-accent': 'hsl(174, 62%, 40%)',
  '--tenant-logo': 'url("/cdn/tenant/logo-published.svg")',
};

const draftTokens: ThemeTokens = {
  '--tenant-primary': 'hsl(0, 80%, 45%)',
  '--tenant-accent': 'hsl(43, 96%, 56%)',
  '--tenant-logo': 'url("/cdn/tenant/logo-draft.svg")',
};

const createTenantInput: CreateTenantInput = {
  name: 'Ministry of Education',
  slug: 'ministry-edu',
  plan: 'professional',
  region: 'us-east-1',
  admin: {
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@ministry-edu.org',
    password: 'SecureP@ss123',
  },
};

// ─── Test Permission Model ──────────────────────────────────────────────────
//
// Tests pass an `x-test-user` header to identify which simulated user is
// hitting the endpoint. The permission resolver maps that header value to
// the user's permission set. This keeps the test wiring simple while still
// exercising the same code path the production `requirePermission` plugin
// uses.

interface TestUser {
  permissions: Set<string>;
}

const testUsers: Record<string, TestUser> = {
  // A tenant admin who can both edit and preview branding.
  admin: { permissions: new Set(['branding:edit', 'branding:preview']) },
  // A read-only viewer with NO branding permissions.
  viewer: { permissions: new Set([]) },
  // A previewer who can ONLY preview drafts (e.g. comms reviewer role).
  previewer: { permissions: new Set(['branding:preview']) },
};

const testHasPermission: BrandingPermissionResolver = (request, permission) => {
  const userId = request.headers['x-test-user'] as string | undefined;
  if (!userId) return false;
  const user = testUsers[userId];
  if (!user) return false;
  return user.permissions.has(permission);
};

// ─── Test Setup ─────────────────────────────────────────────────────────────

describe('Tenant Branding Preview Path (Task 58.3)', () => {
  let app: FastifyInstance;
  let service: TenantService;
  let repository: InMemoryTenantRepository;
  let tenantId: string;

  beforeEach(async () => {
    repository = new InMemoryTenantRepository();
    service = new TenantService(repository);

    app = Fastify();
    await registerTenantRoutes(app, { tenantService: service });
    await registerBrandingRoutes(app, {
      tenantService: service,
      getTenantId: (req: FastifyRequest) =>
        req.headers['x-tenant-id'] as string | undefined,
      hasPermission: testHasPermission,
    });
    await app.ready();

    const createRes = await app.inject({
      method: 'POST',
      url: '/tenants',
      payload: createTenantInput,
    });
    expect(createRes.statusCode).toBe(201);
    tenantId = createRes.json().id as string;

    // Pre-publish a baseline revision so "active branding" returns
    // something concrete (otherwise it would return null tokens, which
    // makes the draft-vs-published assertions trivial).
    const publishRes = await app.inject({
      method: 'POST',
      url: '/tenant/branding/publish',
      headers: { 'x-tenant-id': tenantId },
      payload: { tokens: publishedTokens, publishedBy: PUBLISHER_ALICE },
    });
    expect(publishRes.statusCode).toBe(201);
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const saveDraft = (
    tokens: ThemeTokens,
    asUser: keyof typeof testUsers,
    savedBy = EDITOR_BOB,
  ) =>
    app.inject({
      method: 'POST',
      url: '/tenant/branding/draft',
      headers: {
        'x-tenant-id': tenantId,
        'x-test-user': asUser,
      },
      payload: { tokens, savedBy },
    });

  const getActive = (overrides: {
    asUser?: keyof typeof testUsers;
    cookie?: string;
    header?: string;
  } = {}) => {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId };
    if (overrides.asUser) headers['x-test-user'] = overrides.asUser;
    if (overrides.cookie !== undefined) headers['cookie'] = overrides.cookie;
    if (overrides.header !== undefined) {
      headers[PREVIEW_HEADER_NAME] = overrides.header;
    }
    return app.inject({
      method: 'GET',
      url: '/tenant/branding/active',
      headers,
    });
  };

  // ─── Draft endpoint authorization ────────────────────────────────────────

  describe('POST /tenant/branding/draft (authorization)', () => {
    it('rejects an anonymous draft save with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tenant/branding/draft',
        headers: { 'x-tenant-id': tenantId },
        payload: { tokens: draftTokens, savedBy: EDITOR_BOB },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('rejects a viewer (no branding:edit) with 403', async () => {
      const res = await saveDraft(draftTokens, 'viewer');
      expect(res.statusCode).toBe(403);
    });

    it('rejects a previewer (only branding:preview) with 403', async () => {
      const res = await saveDraft(draftTokens, 'previewer');
      expect(res.statusCode).toBe(403);
    });

    it('accepts an admin (branding:edit) with 201', async () => {
      const res = await saveDraft(draftTokens, 'admin');
      expect(res.statusCode).toBe(201);
      expect(res.json().tokens).toEqual(draftTokens);
      expect(res.json().tenantId).toBe(tenantId);
      expect(res.json().savedBy).toBe(EDITOR_BOB);
    });

    it('replaces a prior draft on subsequent save (UPSERT semantics)', async () => {
      const v1 = await saveDraft(draftTokens, 'admin');
      expect(v1.statusCode).toBe(201);

      const replacement: ThemeTokens = {
        '--tenant-primary': 'hsl(258, 70%, 50%)',
      };
      const v2 = await saveDraft(replacement, 'admin');
      expect(v2.statusCode).toBe(201);
      expect(v2.json().tokens).toEqual(replacement);

      // GET the draft — must reflect v2 only.
      const get = await app.inject({
        method: 'GET',
        url: '/tenant/branding/draft',
        headers: { 'x-tenant-id': tenantId, 'x-test-user': 'admin' },
      });
      expect(get.statusCode).toBe(200);
      expect(get.json().tokens).toEqual(replacement);
    });
  });

  describe('DELETE /tenant/branding/draft', () => {
    it('rejects without branding:edit', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/tenant/branding/draft',
        headers: { 'x-tenant-id': tenantId, 'x-test-user': 'previewer' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('discards the draft and returns 204', async () => {
      await saveDraft(draftTokens, 'admin');

      const del = await app.inject({
        method: 'DELETE',
        url: '/tenant/branding/draft',
        headers: { 'x-tenant-id': tenantId, 'x-test-user': 'admin' },
      });
      expect(del.statusCode).toBe(204);

      // Subsequent active read with preview signal falls back to published.
      const active = await getActive({
        asUser: 'admin',
        cookie: `${PREVIEW_COOKIE_NAME}=draft`,
      });
      expect(active.json().source).toBe('published');
      expect(active.json().tokens).toEqual(publishedTokens);
    });

    it('is idempotent — DELETE on no-draft state returns 204', async () => {
      const del = await app.inject({
        method: 'DELETE',
        url: '/tenant/branding/draft',
        headers: { 'x-tenant-id': tenantId, 'x-test-user': 'admin' },
      });
      expect(del.statusCode).toBe(204);
    });
  });

  // ─── GET /tenant/branding/active — preview matrix ────────────────────────
  //
  // The four scenarios from tasks.md 58.3.

  describe('GET /tenant/branding/active', () => {
    beforeEach(async () => {
      // Seed a draft so the preview path has something to surface.
      const r = await saveDraft(draftTokens, 'admin');
      expect(r.statusCode).toBe(201);
    });

    it('anonymous request returns published tokens (no preview consideration)', async () => {
      const res = await getActive();
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.source).toBe('published');
      expect(body.tokens).toEqual(publishedTokens);
      expect(typeof body.revision).toBe('number');
    });

    it('user WITHOUT branding:preview + cookie set → published tokens', async () => {
      const res = await getActive({
        asUser: 'viewer',
        cookie: `${PREVIEW_COOKIE_NAME}=draft-abc`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.source).toBe('published');
      expect(body.tokens).toEqual(publishedTokens);
    });

    it('user WITH branding:preview + cookie set → draft tokens', async () => {
      const res = await getActive({
        asUser: 'previewer',
        cookie: `${PREVIEW_COOKIE_NAME}=draft-abc`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.source).toBe('draft');
      expect(body.tokens).toEqual(draftTokens);
      // Drafts have no revision number — they have not been published.
      expect(body.revision).toBeNull();
    });

    it('user WITH branding:preview + header set → draft tokens', async () => {
      const res = await getActive({
        asUser: 'previewer',
        header: 'draft-abc',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toBe('draft');
      expect(res.json().tokens).toEqual(draftTokens);
    });

    it('user WITH branding:preview but NO cookie/header → published tokens', async () => {
      const res = await getActive({ asUser: 'previewer' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.source).toBe('published');
      expect(body.tokens).toEqual(publishedTokens);
    });

    it('admin (has both branding:edit and branding:preview) + cookie → draft tokens', async () => {
      const res = await getActive({
        asUser: 'admin',
        cookie: `${PREVIEW_COOKIE_NAME}=draft-abc`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toBe('draft');
      expect(res.json().tokens).toEqual(draftTokens);
    });

    it('preview signal is only the boolean flag — cookie value is irrelevant', async () => {
      // Verifies that any non-empty cookie value triggers the preview
      // lookup; the actual draft is read from the tenant's saved row.
      const res = await getActive({
        asUser: 'previewer',
        cookie: `${PREVIEW_COOKIE_NAME}=anything-goes-here`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toBe('draft');
    });

    it('cookie alongside other cookies still triggers preview', async () => {
      const res = await getActive({
        asUser: 'previewer',
        cookie: `session=abc123; ${PREVIEW_COOKIE_NAME}=draft-abc; tracking=xyz`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toBe('draft');
    });

    it('empty cookie value does NOT trigger preview', async () => {
      const res = await getActive({
        asUser: 'previewer',
        cookie: `${PREVIEW_COOKIE_NAME}=`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toBe('published');
    });

    it('preview signal with NO draft saved still returns published tokens', async () => {
      // Discard the seeded draft.
      const del = await app.inject({
        method: 'DELETE',
        url: '/tenant/branding/draft',
        headers: { 'x-tenant-id': tenantId, 'x-test-user': 'admin' },
      });
      expect(del.statusCode).toBe(204);

      const res = await getActive({
        asUser: 'previewer',
        cookie: `${PREVIEW_COOKIE_NAME}=draft-abc`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toBe('published');
      expect(res.json().tokens).toEqual(publishedTokens);
    });

    it('returns 400 when no tenant context is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tenant/branding/active',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TENANT_REQUIRED');
    });
  });

  // ─── Fail-closed default ─────────────────────────────────────────────────

  describe('default fail-closed behavior', () => {
    it('rejects all preview signals when no permission resolver is supplied', async () => {
      // Spin up a fresh app WITHOUT the hasPermission hook.
      const closedApp = Fastify();
      const closedRepo = new InMemoryTenantRepository();
      const closedService = new TenantService(closedRepo);
      await registerTenantRoutes(closedApp, { tenantService: closedService });
      await registerBrandingRoutes(closedApp, {
        tenantService: closedService,
        getTenantId: (req) =>
          req.headers['x-tenant-id'] as string | undefined,
        // No `hasPermission` — should default to "deny everything".
      });
      await closedApp.ready();

      // Bootstrap tenant + published revision.
      const create = await closedApp.inject({
        method: 'POST',
        url: '/tenants',
        payload: createTenantInput,
      });
      const closedTenantId = create.json().id as string;
      await closedApp.inject({
        method: 'POST',
        url: '/tenant/branding/publish',
        headers: { 'x-tenant-id': closedTenantId },
        payload: { tokens: publishedTokens, publishedBy: PUBLISHER_ALICE },
      });

      // Without a permission resolver, the draft endpoints reject every
      // request — even one that would otherwise be authorized.
      const draftRes = await closedApp.inject({
        method: 'POST',
        url: '/tenant/branding/draft',
        headers: { 'x-tenant-id': closedTenantId, 'x-test-user': 'admin' },
        payload: { tokens: draftTokens, savedBy: EDITOR_BOB },
      });
      expect(draftRes.statusCode).toBe(403);

      // Active branding with a preview cookie still serves published —
      // the resolver denies, so the cookie has no effect.
      const activeRes = await closedApp.inject({
        method: 'GET',
        url: '/tenant/branding/active',
        headers: {
          'x-tenant-id': closedTenantId,
          cookie: `${PREVIEW_COOKIE_NAME}=draft-abc`,
        },
      });
      expect(activeRes.statusCode).toBe(200);
      expect(activeRes.json().source).toBe('published');
    });
  });

  // ─── Decommissioned tenant ───────────────────────────────────────────────

  describe('decommissioned tenant', () => {
    it('rejects saving a draft for a decommissioned tenant', async () => {
      await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/decommission`,
        payload: { reason: 'Contract ended', retainDataDays: 30 },
      });

      const res = await saveDraft(draftTokens, 'admin');
      expect(res.statusCode).toBe(422);
    });
  });
});
