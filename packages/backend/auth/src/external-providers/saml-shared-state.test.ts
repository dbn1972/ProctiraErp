/**
 * PRC-M589: SAML RelayState and the Assertion-ID replay cache are shared
 * between replicas. Two SAMLProvider instances stand in for two gateway
 * replicas; they share only the injected Redis-shaped stores.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedisWebTicketStore } from '../keycloak/routes.js';
import { RedisAssertionReplayStore } from './pending-auth-state.js';
import { SAMLProvider } from './saml-provider.js';
import type { SAMLParsedResponse, SAMLResponseParser } from './saml-provider.js';
import type { SAMLProviderConfig } from './types.js';

/** In-process stand-in for one Redis server: SET [EX] [NX] and GETDEL. */
class FakeRedis {
  readonly values = new Map<string, string>();
  readonly calls: unknown[][] = [];
  async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    this.calls.push([key, value, ...args]);
    if (args.includes('NX') && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }
  async getdel(key: string): Promise<string | null> {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
}

class FixedAssertionParser implements SAMLResponseParser {
  readonly verifiesSignature = true;
  async parseResponse(
    _samlResponse: string,
    _config: SAMLProviderConfig,
    context?: { expectedInResponseTo: string },
  ): Promise<SAMLParsedResponse> {
    return {
      nameId: 'teacher@school.example',
      attributes: {
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress':
          'teacher@school.example',
      },
      inResponseTo: context?.expectedInResponseTo,
      assertionId: '_assertion-fixed',
    } as SAMLParsedResponse;
  }
}

const baseConfig: Omit<SAMLProviderConfig, 'stateStore' | 'replayStore'> = {
  type: 'saml',
  providerId: 'corp-saml',
  displayName: 'Corporate SAML',
  entryPoint: 'https://idp.corp.example/sso',
  idpCertificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
  issuer: 'https://app.example/saml/metadata',
  callbackUrl: 'https://app.example/auth/saml/callback',
};

function replicas() {
  const redis = new FakeRedis();
  const make = () =>
    new SAMLProvider(
      {
        ...baseConfig,
        stateStore: new RedisWebTicketStore(redis, 'auth:ext-pending:'),
        replayStore: new RedisAssertionReplayStore(redis),
      },
      new FixedAssertionParser(),
    );
  return { redis, one: make(), two: make() };
}

describe('SAML pending state and replay cache across replicas (PRC-M589)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a callback served by another replica completes the login', async () => {
    const { one, two } = replicas();
    const started = await one.initiateAuth('tenant-1');
    const profile = await two.handleCallback(
      { samlResponse: 'base64-response', relayState: started.state },
      'tenant-1',
    );
    expect(profile.email).toBe('teacher@school.example');
  });

  it('a RelayState is single use on every replica', async () => {
    const { one, two } = replicas();
    const started = await one.initiateAuth('tenant-1');
    await two.handleCallback({ samlResponse: 'r', relayState: started.state }, 'tenant-1');
    await expect(
      one.handleCallback({ samlResponse: 'r', relayState: started.state }, 'tenant-1'),
    ).rejects.toMatchObject({ code: 'SAML_INVALID_RELAY_STATE' });
  });

  it('an assertion consumed on one replica is refused as a replay on the other', async () => {
    const { redis, one, two } = replicas();
    const first = await one.initiateAuth('tenant-1');
    await one.handleCallback({ samlResponse: 'r', relayState: first.state }, 'tenant-1');
    const second = await two.initiateAuth('tenant-1');
    await expect(
      two.handleCallback({ samlResponse: 'r', relayState: second.state }, 'tenant-1'),
    ).rejects.toMatchObject({ code: 'SAML_ASSERTION_REPLAY' });
    const claim = redis.calls.find(([key]) => String(key).startsWith('auth:saml-assertion:'));
    expect(claim).toEqual([
      'auth:saml-assertion:corp-saml:_assertion-fixed',
      '1',
      'EX',
      86_400,
      'NX',
    ]);
  });

  it('refuses to start without shared stores in a deployed environment', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new SAMLProvider({ ...baseConfig }, new FixedAssertionParser())).toThrow(
      /PRC-M589/,
    );
    const redis = new FakeRedis();
    expect(
      () =>
        new SAMLProvider(
          { ...baseConfig, stateStore: new RedisWebTicketStore(redis) },
          new FixedAssertionParser(),
        ),
    ).toThrow(/replay store/);
  });
});
