// @vitest-environment node
/**
 * PRC-H018: the portal resolves the gateway base URL through one server-only
 * helper (fail-closed in production) and never issues relative `/api` calls
 * from the server.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { browserTransport, getInstitutions } from './api';
import { gatewayRequest } from './gateway';
import { buildRegistrationProxyPath, getGatewayApiBaseUrl } from './gateway-config';

describe('getGatewayApiBaseUrl (PRC-H018)', () => {
  it('throws in production when GATEWAY_URL is unset', () => {
    expect(() => getGatewayApiBaseUrl({ NODE_ENV: 'production' })).toThrow(
      /GATEWAY_URL is required/,
    );
    expect(() => getGatewayApiBaseUrl({ NODE_ENV: 'production', GATEWAY_URL: '  ' })).toThrow(
      /GATEWAY_URL is required/,
    );
  });

  it('rejects relative or non-http values', () => {
    expect(() => getGatewayApiBaseUrl({ NODE_ENV: 'production', GATEWAY_URL: '/api' })).toThrow(
      /absolute/,
    );
    expect(() =>
      getGatewayApiBaseUrl({ NODE_ENV: 'production', GATEWAY_URL: 'ftp://gateway' }),
    ).toThrow(/http or https/);
  });

  it('appends the /api/v1 mount prefix exactly once', () => {
    expect(
      getGatewayApiBaseUrl({ NODE_ENV: 'production', GATEWAY_URL: 'http://api-gateway:3000' }),
    ).toBe('http://api-gateway:3000/api/v1');
    expect(
      getGatewayApiBaseUrl({
        NODE_ENV: 'production',
        GATEWAY_URL: 'http://api-gateway:3000/api/v1/',
      }),
    ).toBe('http://api-gateway:3000/api/v1');
  });

  it('uses the local gateway only outside production', () => {
    expect(getGatewayApiBaseUrl({ NODE_ENV: 'development' })).toBe('http://localhost:3000/api/v1');
  });
});

describe('buildRegistrationProxyPath', () => {
  it('maps proxy segments under /registrations and keeps the query', () => {
    expect(buildRegistrationProxyPath(undefined, '')).toBe('/registrations');
    expect(buildRegistrationProxyPath(['institutions'], '?page=2')).toBe(
      '/registrations/institutions?page=2',
    );
  });

  it('rejects dot segments that would escape /registrations', () => {
    expect(buildRegistrationProxyPath(['..', 'admin'], '')).toBeNull();
    expect(buildRegistrationProxyPath(['.'], '')).toBeNull();
  });
});

describe('server transport (PRC-H018)', () => {
  const seen: { url?: string; method?: string }[] = [];
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ url: req.url, method: req.method });
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          data: [{ id: 'i-1', name: 'School A' }],
          meta: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('calls the absolute gateway /api/v1 URL, not a relative /api path', async () => {
    const response = await getInstitutions({ page: 1 }, (path, init) =>
      gatewayRequest(path, init, { baseUrl }),
    );
    expect(response.data[0]?.name).toBe('School A');
    expect(seen.at(-1)).toEqual({
      url: '/api/v1/registrations/institutions?page=1',
      method: 'GET',
    });
  });

  it('refuses to use the relative browser transport on the server', () => {
    expect(() => browserTransport('/registrations/institutions')).toThrow(/serverTransport/);
  });
});
