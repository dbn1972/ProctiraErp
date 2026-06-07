/**
 * Tenant Branding Routes — Rollback Round-Trip Integration Tests (Task 58.2)
 *
 * Exercises the publish → rollback flow end-to-end through the Fastify
 * route layer using `app.inject()`, verifying the four invariants of the
 * append-only versioning model (Design §N):
 *
 *   1. Each publish appends a new row with monotonically increasing
 *      revision numbers (1, 2, 3, …).
 *   2. Rolling back to a prior revision restores the active tokens on
 *      `tenant_settings.theme`.
 *   3. The rollback itself is recorded as a NEW revision row at the next
 *      revision number — the original rows are never mutated or replaced.
 *   4. Round-tripping through publish-then-rollback-then-publish
 *      preserves the full audit trail in chronological order.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { TenantService } from './tenant-service.js';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import { registerTenantRoutes } from './routes.js';
import { registerBrandingRoutes } from './branding-routes.js';
import type { CreateTenantInput, ThemeTokens } from './schemas.js';

describe('Tenant Branding Routes (Task 58.2 — rollback round-trip)', () => {
  let app: FastifyInstance;
  let service: TenantService;
  let repository: InMemoryTenantRepository;
  let tenantId: string;

  // Two valid UUID v4s to play the role of "publishedBy" (any platform user).
  const PUBLISHER_ALICE = '11111111-1111-4111-8111-111111111111';
  const PUBLISHER_BOB = '22222222-2222-4222-8222-222222222222';

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

  const tokensV1: ThemeTokens = {
    '--tenant-primary': 'hsl(222, 47%, 31%)',
    '--tenant-accent': 'hsl(174, 62%, 40%)',
    '--tenant-logo': 'url("/cdn/tenant-1/logo-v1.svg")',
  };

  const tokensV2: ThemeTokens = {
    '--tenant-primary': 'hsl(0, 80%, 45%)',
    '--tenant-accent': 'hsl(43, 96%, 35%)',
    '--tenant-logo': 'url("/cdn/tenant-1/logo-v2.svg")',
  };

  const tokensV3: ThemeTokens = {
    '--tenant-primary': 'hsl(258, 70%, 50%)',
    '--tenant-accent': 'hsl(174, 62%, 40%)',
    '--tenant-logo': 'url("/cdn/tenant-1/logo-v3.svg")',
  };

  beforeEach(async () => {
    repository = new InMemoryTenantRepository();
    service = new TenantService(repository);

    // Build a fresh tenant once per test and let the branding handler
    // resolve the active tenant id from a custom resolver that reads the
    // `x-tenant-id` request header — this isolates the branding tests from
    // the gateway middleware in production.
    app = Fastify();
    await registerTenantRoutes(app, { tenantService: service });
    await registerBrandingRoutes(app, {
      tenantService: service,
      getTenantId: (req) => (req.headers['x-tenant-id'] as string | undefined),
    });
    await app.ready();

    const createRes = await app.inject({
      method: 'POST',
      url: '/tenants',
      payload: createTenantInput,
    });
    expect(createRes.statusCode).toBe(201);
    tenantId = createRes.json().id as string;
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  const publish = (tokens: ThemeTokens, publishedBy = PUBLISHER_ALICE) =>
    app.inject({
      method: 'POST',
      url: '/tenant/branding/publish',
      headers: { 'x-tenant-id': tenantId },
      payload: { tokens, publishedBy },
    });

  const rollback = (revision: number, publishedBy = PUBLISHER_BOB) =>
    app.inject({
      method: 'POST',
      url: '/tenant/branding/rollback',
      headers: { 'x-tenant-id': tenantId },
      payload: { revision, publishedBy },
    });

  const listVersions = () =>
    app.inject({
      method: 'GET',
      url: '/tenant/branding/versions',
      headers: { 'x-tenant-id': tenantId },
    });

  const getActive = () =>
    app.inject({
      method: 'GET',
      url: '/tenant/branding',
      headers: { 'x-tenant-id': tenantId },
    });

  // ─── Publish flow ───────────────────────────────────────────────────────

  describe('POST /tenant/branding/publish', () => {
    it('returns 400 when no tenant context is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tenant/branding/publish',
        payload: { tokens: tokensV1, publishedBy: PUBLISHER_ALICE },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('TENANT_REQUIRED');
    });

    it('returns 400 when publishedBy is not a UUID', async () => {
      const response = await publish(tokensV1, 'not-a-uuid');
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('appends rows with monotonically increasing revision numbers', async () => {
      const r1 = await publish(tokensV1);
      const r2 = await publish(tokensV2);
      const r3 = await publish(tokensV3);

      expect(r1.statusCode).toBe(201);
      expect(r2.statusCode).toBe(201);
      expect(r3.statusCode).toBe(201);

      expect(r1.json().revision).toBe(1);
      expect(r2.json().revision).toBe(2);
      expect(r3.json().revision).toBe(3);

      // Tokens echoed back match what was published.
      expect(r1.json().tokens).toEqual(tokensV1);
      expect(r2.json().tokens).toEqual(tokensV2);
      expect(r3.json().tokens).toEqual(tokensV3);
    });

    it('mirrors the latest published tokens onto the active branding read', async () => {
      await publish(tokensV1);
      await publish(tokensV2);

      const active = await getActive();
      expect(active.statusCode).toBe(200);
      expect(active.json().tokens).toEqual(tokensV2);
      expect(active.json().revision).toBe(2);
    });
  });

  // ─── Rollback round-trip ────────────────────────────────────────────────

  describe('POST /tenant/branding/rollback', () => {
    it('rejects rollback when no tenant context is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tenant/branding/rollback',
        payload: { revision: 1, publishedBy: PUBLISHER_BOB },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('TENANT_REQUIRED');
    });

    it('rejects rollback to a non-existent revision with 404', async () => {
      await publish(tokensV1);
      const response = await rollback(999);
      expect(response.statusCode).toBe(404);
    });

    it('rejects validation when revision is below 1', async () => {
      await publish(tokensV1);
      const response = await rollback(0);
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('round-trips: publish v1, v2, v3, then rollback to v1', async () => {
      await publish(tokensV1, PUBLISHER_ALICE);
      await publish(tokensV2, PUBLISHER_ALICE);
      await publish(tokensV3, PUBLISHER_ALICE);

      // Rollback restores v1 tokens and APPENDS a new revision = 4.
      const rollbackRes = await rollback(1, PUBLISHER_BOB);
      expect(rollbackRes.statusCode).toBe(201);

      const audit = rollbackRes.json();
      expect(audit.revision).toBe(4);
      expect(audit.tokens).toEqual(tokensV1);
      // The publisher recorded on the new audit row is the ROLLBACK actor,
      // not the original publisher of the restored revision.
      expect(audit.publishedBy).toBe(PUBLISHER_BOB);

      // Active tokens now reflect the rolled-back state.
      const active = await getActive();
      expect(active.statusCode).toBe(200);
      expect(active.json().tokens).toEqual(tokensV1);
      expect(active.json().revision).toBe(4);
    });

    it('preserves the original revision rows untouched (append-only audit)', async () => {
      const v1 = await publish(tokensV1, PUBLISHER_ALICE);
      const v2 = await publish(tokensV2, PUBLISHER_ALICE);
      const v3 = await publish(tokensV3, PUBLISHER_ALICE);

      const v1Id = v1.json().id as string;
      const v1PublishedAt = v1.json().publishedAt as string;
      const v1PublishedBy = v1.json().publishedBy as string;

      await rollback(1, PUBLISHER_BOB);

      const versionsRes = await listVersions();
      expect(versionsRes.statusCode).toBe(200);
      const versions = versionsRes.json().data as Array<{
        id: string;
        revision: number;
        tokens: ThemeTokens;
        publishedBy: string;
        publishedAt: string;
      }>;

      // 3 publishes + 1 rollback audit row = 4 rows total.
      expect(versions).toHaveLength(4);

      // Revisions are in ascending order: 1, 2, 3, 4.
      expect(versions.map((v) => v.revision)).toEqual([1, 2, 3, 4]);

      // The original v1 row is byte-for-byte unchanged.
      const v1Row = versions[0]!;
      expect(v1Row.id).toBe(v1Id);
      expect(v1Row.publishedAt).toBe(v1PublishedAt);
      expect(v1Row.publishedBy).toBe(v1PublishedBy);
      expect(v1Row.tokens).toEqual(tokensV1);

      // v2 and v3 rows are equally untouched.
      expect(versions[1]!.tokens).toEqual(tokensV2);
      expect(versions[1]!.id).toBe(v2.json().id);
      expect(versions[2]!.tokens).toEqual(tokensV3);
      expect(versions[2]!.id).toBe(v3.json().id);

      // The rollback audit row carries the restored tokens and the rollback actor.
      const auditRow = versions[3]!;
      expect(auditRow.tokens).toEqual(tokensV1);
      expect(auditRow.publishedBy).toBe(PUBLISHER_BOB);
    });

    it('a rollback can itself be rolled back (rollback-to-rollback)', async () => {
      await publish(tokensV1, PUBLISHER_ALICE); // rev 1
      await publish(tokensV2, PUBLISHER_ALICE); // rev 2
      await rollback(1, PUBLISHER_BOB); // rev 3 — restores v1
      await rollback(2, PUBLISHER_BOB); // rev 4 — restores v2

      const active = await getActive();
      expect(active.json().tokens).toEqual(tokensV2);
      expect(active.json().revision).toBe(4);

      const versions = (await listVersions()).json().data as Array<{
        revision: number;
        tokens: ThemeTokens;
      }>;
      expect(versions.map((v) => v.tokens)).toEqual([
        tokensV1,
        tokensV2,
        tokensV1,
        tokensV2,
      ]);
    });

    it('a rollback followed by a fresh publish keeps the audit trail intact', async () => {
      await publish(tokensV1, PUBLISHER_ALICE); // rev 1
      await publish(tokensV2, PUBLISHER_ALICE); // rev 2
      await rollback(1, PUBLISHER_BOB); // rev 3
      await publish(tokensV3, PUBLISHER_ALICE); // rev 4

      const versions = (await listVersions()).json().data as Array<{
        revision: number;
      }>;
      expect(versions.map((v) => v.revision)).toEqual([1, 2, 3, 4]);

      const active = await getActive();
      expect(active.json().tokens).toEqual(tokensV3);
      expect(active.json().revision).toBe(4);
    });
  });

  // ─── Listing ───────────────────────────────────────────────────────────

  describe('GET /tenant/branding/versions', () => {
    it('returns an empty list when no revision has been published', async () => {
      const response = await listVersions();
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    });

    it('returns 404 when the tenant id does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tenant/branding/versions',
        headers: { 'x-tenant-id': '00000000-0000-4000-8000-000000000000' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Active branding read ─────────────────────────────────────────────

  describe('GET /tenant/branding', () => {
    it('returns null tokens when no revision has been published', async () => {
      const response = await getActive();
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tokens).toBeNull();
      expect(body.revision).toBeNull();
    });
  });

  // ─── Rollback for decommissioned tenant ────────────────────────────────

  describe('decommissioned tenant', () => {
    it('rejects publish for a decommissioned tenant', async () => {
      await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/decommission`,
        payload: { reason: 'Contract ended', retainDataDays: 30 },
      });

      const response = await publish(tokensV1);
      expect(response.statusCode).toBe(422);
    });

    it('rejects rollback for a decommissioned tenant', async () => {
      await publish(tokensV1);
      await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/decommission`,
        payload: { reason: 'Contract ended', retainDataDays: 30 },
      });

      const response = await rollback(1);
      expect(response.statusCode).toBe(422);
    });
  });

  // ─── Publish-time validation guards (Task 58.4) ────────────────────────

  describe('validation guards (Requirement 28 AC 7-9)', () => {
    it('rejects publish with 400 + structured error for low-contrast primary', async () => {
      const lowContrastTokens: ThemeTokens = {
        '--tenant-primary': '#cccccc', // ~1.6:1 against white — below 4.5:1
        '--tenant-accent': 'hsl(174, 62%, 40%)',
      };

      const response = await publish(lowContrastTokens);
      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(body.errors)).toBe(true);
      const primaryError = body.errors.find(
        (e: { field: string }) => e.field === 'tokens.--tenant-primary',
      );
      expect(primaryError).toBeDefined();
      expect(primaryError.rule).toBe('contrast');
      expect(primaryError.message).toMatch(/4\.5:1/);
    });

    it('rejects publish for a low-contrast accent color', async () => {
      const tokens: ThemeTokens = {
        '--tenant-primary': 'hsl(222, 47%, 31%)',
        '--tenant-accent': 'hsl(43, 96%, 56%)', // ~1.69:1 — below 3:1
      };

      const response = await publish(tokens);
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      const accentError = body.errors.find(
        (e: { field: string }) => e.field === 'tokens.--tenant-accent',
      );
      expect(accentError).toBeDefined();
      expect(accentError.rule).toBe('contrast');
    });

    it('does NOT append a tenant_theme_versions row when validation fails', async () => {
      // Ensure there is one valid revision first so we can detect any
      // unintended insert from the rejected publish.
      await publish(tokensV1);

      const before = (await listVersions()).json().data.length;
      const response = await publish({ '--tenant-primary': '#cccccc' });
      expect(response.statusCode).toBe(400);

      const after = (await listVersions()).json().data.length;
      expect(after).toBe(before);
    });
  });
});
