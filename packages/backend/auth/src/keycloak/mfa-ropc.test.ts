/**
 * PRC-H043 — the Keycloak ROPC `/password` flow must not issue tokens to a user
 * whose policy requires MFA without a verified second factor. It returns an
 * `mfa_required` challenge (sent via the existing OTP service); tokens are handed
 * out only after POST /password/mfa verifies the code.
 */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryOtpChallengeStore, OtpService } from '../otp-service.js';
import { ConsoleSmsProvider } from '../sms-provider.js';
import {
  MemoryWebTicketStore,
  registerKeycloakAuthRoutes,
  type MfaPolicyDecision,
} from './routes.js';

const BASE = {
  issuer: 'http://localhost:8180/realms/proctira',
  clientId: 'proctira-gateway',
  realm: 'proctira',
  jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
  redirectUri: 'http://localhost:3200/api/v1/auth/callback',
};

function makeAccessToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

function mockKeycloakToken(accessToken: string) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = String((init as RequestInit | undefined)?.body ?? '');
    // Keycloak logout (end-session) returns 204; token endpoint returns tokens.
    if (body.includes('grant_type=password')) {
      return new Response(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          expires_in: 300,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('', { status: 204 });
  });
}

function otpService() {
  return new OtpService({
    store: new InMemoryOtpChallengeStore(),
    sms: new ConsoleSmsProvider(),
    exposeCodeInResponse: true, // test-only: lets us read the code to complete the flow
  });
}

const MFA_USER = makeAccessToken({ sub: 'kc-u', email: 'u@proctira.in', tenant_id: 'tenant-1' });

describe('PRC-H043 MFA on ROPC /password', () => {
  it('returns mfa_required (no tokens) when policy requires MFA', async () => {
    const fetchMock = mockKeycloakToken(MFA_USER);
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      ...BASE,
      otpService: otpService(),
      mfaPolicy: async (): Promise<MfaPolicyDecision> => ({
        required: true,
        phone: '+15550001111',
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'u@proctira.in', password: 'pw' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.status).toBe('mfa_required');
    expect(body.mfaToken).toBeTruthy();
    // Critically: no tokens were issued.
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    fetchMock.mockRestore();
    await app.close();
  });

  it('issues tokens only after the OTP is verified via /password/mfa', async () => {
    const fetchMock = mockKeycloakToken(MFA_USER);
    const otp = otpService();
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      ...BASE,
      otpService: otp,
      mfaPolicy: async (): Promise<MfaPolicyDecision> => ({
        required: true,
        phone: '+15550001111',
      }),
    });
    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'u@proctira.in', password: 'pw' },
    });
    const { mfaToken, debugCode } = start.json() as { mfaToken: string; debugCode: string };
    expect(debugCode).toMatch(/^\d{6}$/);

    // Wrong code: no tokens.
    const wrong = debugCode === '000000' ? '111111' : '000000';
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/mfa',
      payload: { mfaToken, code: wrong },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().accessToken).toBeUndefined();

    // Correct code: tokens are returned.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/mfa',
      payload: { mfaToken, code: debugCode },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBe(MFA_USER);
    fetchMock.mockRestore();
    await app.close();
  });

  it('fails closed (503) when the MFA policy lookup throws', async () => {
    const fetchMock = mockKeycloakToken(MFA_USER);
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      ...BASE,
      otpService: otpService(),
      mfaPolicy: async () => {
        throw new Error('policy store down');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'u@proctira.in', password: 'pw' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().accessToken).toBeUndefined();
    fetchMock.mockRestore();
    await app.close();
  });

  it('fails closed (403) when MFA is required but no OTP service/phone is available', async () => {
    const fetchMock = mockKeycloakToken(MFA_USER);
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      ...BASE,
      // mfaPolicy required but no otpService configured.
      mfaPolicy: async (): Promise<MfaPolicyDecision> => ({ required: true }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'u@proctira.in', password: 'pw' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().accessToken).toBeUndefined();
    fetchMock.mockRestore();
    await app.close();
  });

  it('issues tokens directly when policy does not require MFA (unchanged path)', async () => {
    const fetchMock = mockKeycloakToken(MFA_USER);
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      ...BASE,
      otpService: otpService(),
      mfaPolicy: async (): Promise<MfaPolicyDecision> => ({ required: false }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'u@proctira.in', password: 'pw' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBe(MFA_USER);
    fetchMock.mockRestore();
    await app.close();
  });

  describe('MFA hold is not redeemable as a web ticket', () => {
    async function startMfa(app: ReturnType<typeof Fastify>) {
      const start = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password',
        payload: { username: 'u@proctira.in', password: 'pw' },
      });
      expect(start.statusCode).toBe(401);
      return start.json() as { mfaToken: string; debugCode: string };
    }
    const mfaApp = async (extra: Record<string, unknown> = {}) => {
      const app = Fastify();
      await registerKeycloakAuthRoutes(app, {
        ...BASE,
        otpService: otpService(),
        mfaPolicy: async (): Promise<MfaPolicyDecision> => ({
          required: true,
          phone: '+15550001111',
        }),
        ...extra,
      });
      return app;
    };

    it('GET /ticket?ticket=mfa-pending:<mfaToken> returns the unknown-ticket response, no tokens', async () => {
      const fetchMock = mockKeycloakToken(MFA_USER);
      const app = await mfaApp();
      const { mfaToken, debugCode } = await startMfa(app);

      for (const ticket of [`mfa-pending:${mfaToken}`, mfaToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/auth/ticket?ticket=${encodeURIComponent(ticket)}`,
        });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({
          code: 'KEYCLOAK_TICKET_INVALID',
          message: 'Login ticket is invalid or expired',
          statusCode: 401,
        });
        expect(res.body).not.toContain(MFA_USER);
        expect(res.body).not.toContain('refresh-1');
      }

      // The probe did not consume the hold: the legitimate OTP completion still works.
      const ok = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/mfa',
        payload: { mfaToken, code: debugCode },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().accessToken).toBe(MFA_USER);
      fetchMock.mockRestore();
      await app.close();
    });

    it('the hold is isolated even when a shared web-ticket store is configured', async () => {
      const fetchMock = mockKeycloakToken(MFA_USER);
      const shared = new MemoryWebTicketStore();
      const take = vi.spyOn(shared, 'take');
      const put = vi.spyOn(shared, 'put');
      const app = await mfaApp({ webTicketStore: shared });
      const { mfaToken } = await startMfa(app);
      // Nothing redeemable via /ticket was written for the MFA hold.
      expect(put).not.toHaveBeenCalled();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/ticket?ticket=mfa-pending:${mfaToken}`,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().accessToken).toBeUndefined();
      // Malformed tickets never reach the store.
      expect(take).not.toHaveBeenCalled();
      fetchMock.mockRestore();
      await app.close();
    });

    it('refuses to share one store instance between web tickets and the MFA hold', async () => {
      const shared = new MemoryWebTicketStore();
      await expect(
        registerKeycloakAuthRoutes(Fastify(), {
          ...BASE,
          webTicketStore: shared,
          mfaPendingStore: shared,
        }),
      ).rejects.toThrow(/mfaPendingStore/);
    });

    it('/password/mfa with the correct code returns tokens exactly once', async () => {
      const fetchMock = mockKeycloakToken(MFA_USER);
      const app = await mfaApp();
      const { mfaToken, debugCode } = await startMfa(app);
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/mfa',
        payload: { mfaToken, code: debugCode },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().accessToken).toBe(MFA_USER);
      expect(first.json().refreshToken).toBe('refresh-1');

      const replay = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/mfa',
        payload: { mfaToken, code: debugCode },
      });
      expect(replay.statusCode).toBe(401);
      expect(replay.json().accessToken).toBeUndefined();

      // And the consumed hold is not reachable through /ticket either.
      const viaTicket = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/ticket?ticket=mfa-pending:${mfaToken}`,
      });
      expect(viaTicket.statusCode).toBe(401);
      fetchMock.mockRestore();
      await app.close();
    });

    it('a wrong code does not consume the hold', async () => {
      const fetchMock = mockKeycloakToken(MFA_USER);
      const app = await mfaApp();
      const { mfaToken, debugCode } = await startMfa(app);
      const wrong = debugCode === '000000' ? '111111' : '000000';
      const bad = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/mfa',
        payload: { mfaToken, code: wrong },
      });
      expect(bad.statusCode).toBe(401);
      expect(bad.json().code).toBe('MFA_INVALID');
      const ok = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/mfa',
        payload: { mfaToken, code: debugCode },
      });
      expect(ok.statusCode).toBe(200);
      fetchMock.mockRestore();
      await app.close();
    });

    it('refuses (and ends the IdP session) when the verified challenge does not match the hold', async () => {
      const fetchMock = mockKeycloakToken(MFA_USER);
      const otp = otpService();
      const app = Fastify();
      await registerKeycloakAuthRoutes(app, {
        ...BASE,
        otpService: otp,
        mfaPolicy: async (): Promise<MfaPolicyDecision> => ({
          required: true,
          phone: '+15550001111',
        }),
      });
      const { mfaToken, debugCode } = await startMfa(app);
      // Simulate a verifier that reports a different principal than the hold was minted for.
      vi.spyOn(otp, 'verifyChallenge').mockResolvedValueOnce({
        userId: 'someone-else',
        tenantId: 'tenant-1',
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/mfa',
        payload: { mfaToken, code: debugCode },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('MFA_SESSION_EXPIRED');
      expect(res.json().accessToken).toBeUndefined();
      const logoutCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/logout'));
      expect(String((logoutCall?.[1] as RequestInit | undefined)?.body)).toContain(
        'refresh_token=refresh-1',
      );
      fetchMock.mockRestore();
      await app.close();
    });
  });

  it('with no mfaPolicy configured, /password is unchanged (tokens issued)', async () => {
    const fetchMock = mockKeycloakToken(MFA_USER);
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, { ...BASE });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'u@proctira.in', password: 'pw' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBe(MFA_USER);
    fetchMock.mockRestore();
    await app.close();
  });
});
