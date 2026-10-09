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
import { registerKeycloakAuthRoutes, type MfaPolicyDecision } from './routes.js';

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
