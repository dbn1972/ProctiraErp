/**
 * PRC-M538: the verified-email gate on guardian offers must hold for the
 * principals production builds, not a hand-made `request.user`.
 *
 * - Keycloak mode: an RS256 token goes through the real `keycloakAuthPlugin`
 *   (`jwtVerify`, as the gateway's onRequest hook calls it) with an identity
 *   store, and the offers route sees `emailVerified` from the token claim.
 * - Local mode: `TokenService.issueTokenPair` signs `emailVerified` for a
 *   verified login; the gateway's local verify path hands the signed payload
 *   to the route unchanged.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  InMemoryKeycloakIdentityStore,
  MemoryAccessTokenRevocationStore,
  TokenService,
  keycloakAuthPlugin,
} from '@proctira/backend-auth';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdmissionsOffersPort } from './admissions-offers-port.js';
import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';

// RSA key generation can be slow on loaded CI runners.
vi.setConfig({ testTimeout: 30_000 });

const TENANT = '00000000-0000-4000-8000-000000000001';
const GUARDIAN_EMAIL = 'ravi@example.test';
const issuer = 'http://localhost:8180/realms/proctira';
const keycloakConfig = {
  issuer,
  clientId: 'proctira-gateway',
  realm: 'proctira',
  jwksUri: `${issuer}/protocol/openid-connect/certs`,
};

function offersPort(asked: string[]): AdmissionsOffersPort {
  return {
    listGuardianOffers: async (_tenantId, email) => {
      asked.push(`list:${email}`);
      return [];
    },
    acceptOfferForGuardian: async () => {
      throw new Error('not used');
    },
  };
}

function rs256(payload: Record<string, unknown>, pem: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), pem).toString('base64url');
  return `${header}.${body}.${sig}`;
}

describe('PRC-M538 guardian offers with production principals', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  async function keycloakApp(withIdentityStore: boolean) {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', kty: 'RSA' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const asked: string[] = [];
    const instance = Fastify({ logger: false });
    await instance.register(keycloakAuthPlugin, {
      config: keycloakConfig,
      ...(withIdentityStore ? { identityStore: new InMemoryKeycloakIdentityStore() } : {}),
      revocationStore: new MemoryAccessTokenRevocationStore(),
    });
    // Same contract as the gateway's onRequest hook in Keycloak mode.
    instance.addHook('onRequest', async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ code: 'UNAUTHORIZED', statusCode: 401 });
      }
    });
    await instance.register(parentPortalPlugin, {
      repository: new InMemoryParentPortalRepository(),
      admissionsOffers: offersPort(asked),
    });
    await instance.ready();
    app = instance;
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const now = Math.floor(Date.now() / 1000);
    const token = (emailVerified: boolean | undefined) =>
      rs256(
        {
          sub: 'kc-guardian-1',
          iss: issuer,
          azp: 'proctira-gateway',
          exp: now + 600,
          email: GUARDIAN_EMAIL,
          ...(emailVerified === undefined ? {} : { email_verified: emailVerified }),
          tenant_id: TENANT,
          realm_access: { roles: ['parent'] },
          jti: `j-${String(emailVerified)}`,
          sid: `s-${String(emailVerified)}`,
        },
        pem,
      );
    return { instance, asked, token };
  }

  it('Keycloak token with email_verified=true reaches the offers port (identity store linked)', async () => {
    const { instance, asked, token } = await keycloakApp(true);
    const res = await instance.inject({
      method: 'GET',
      url: '/parent-portal/offers',
      headers: { authorization: `Bearer ${token(true)}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(asked).toEqual([`list:${GUARDIAN_EMAIL}`]);
  });

  it.each([[false], [undefined]])(
    'Keycloak token with email_verified=%s gets 400 EMAIL_REQUIRED (no identity store)',
    async (emailVerified) => {
      const { instance, asked, token } = await keycloakApp(false);
      const res = await instance.inject({
        method: 'GET',
        url: '/parent-portal/offers',
        headers: { authorization: `Bearer ${token(emailVerified)}` },
      });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json()).toMatchObject({ code: 'EMAIL_REQUIRED' });
      expect(asked).toEqual([]);
    },
  );

  it.each([
    [true, 200],
    [undefined, 400],
  ])(
    'local TokenService login with emailVerified=%s -> %s on offers',
    async (emailVerified, status) => {
      const signer = {
        sign: (payload: Record<string, unknown>) => JSON.stringify(payload),
        verify: <T>(token: string) => JSON.parse(token) as T,
      };
      const refreshStore = {
        create: async (row: Record<string, unknown>) => ({
          ...row,
          id: 'rt-1',
          createdAt: new Date(),
        }),
        findByToken: async () => null,
        revoke: async () => undefined,
        revokeAllForSession: async () => undefined,
        revokeAllForUser: async () => undefined,
      };
      const tokenService = new TokenService(
        {
          jwt: { accessTokenExpiresIn: 900 },
          refreshToken: { maxLifetime: 3600 },
        } as unknown as ConstructorParameters<typeof TokenService>[0],
        signer as unknown as ConstructorParameters<typeof TokenService>[1],
        refreshStore as unknown as ConstructorParameters<typeof TokenService>[2],
      );
      const { accessToken } = await tokenService.issueTokenPair(
        {
          userId: 'guardian-1',
          tenantId: TENANT,
          email: GUARDIAN_EMAIL,
          displayName: 'Ravi',
          roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
          areas: [],
          institutions: [],
          ...(emailVerified === undefined ? {} : { emailVerified }),
        } as Parameters<TokenService['issueTokenPair']>[0],
        'session-1',
      );
      const asked: string[] = [];
      const instance = Fastify({ logger: false });
      instance.decorateRequest('tenantId', '');
      instance.decorateRequest('user', null);
      // Gateway local mode: `request.user` is the verified token payload as signed.
      instance.addHook('onRequest', async (request) => {
        const payload = signer.verify<{ tenantId: string }>(accessToken);
        (request as unknown as { tenantId: string }).tenantId = payload.tenantId;
        (request as unknown as { user: unknown }).user = payload;
      });
      await instance.register(parentPortalPlugin, {
        repository: new InMemoryParentPortalRepository(),
        admissionsOffers: offersPort(asked),
      });
      await instance.ready();
      app = instance;
      const res = await instance.inject({ method: 'GET', url: '/parent-portal/offers' });
      expect(res.statusCode, res.body).toBe(status);
      expect(asked).toEqual(status === 200 ? [`list:${GUARDIAN_EMAIL}`] : []);
    },
  );
});
