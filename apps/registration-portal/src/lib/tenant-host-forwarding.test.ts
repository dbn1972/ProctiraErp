// @vitest-environment node
/**
 * PRC-H113: the gateway resolves anonymous registration tenants from the raw
 * Host header, so portal server-side calls must forward the applicant's host.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getInstitutions, RegistrationApiError } from './api';
import { gatewayRequest } from './gateway';
import { resolvePublicHost } from './gateway-config';

const reader = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

describe('resolvePublicHost (PRC-H113)', () => {
  it('prefers the first X-Forwarded-Host hop, then Host', () => {
    expect(
      resolvePublicHost(
        reader({ 'x-forwarded-host': 'Tenant-A.example, proxy.internal', host: 'portal:3002' }),
      ),
    ).toBe('tenant-a.example');
    expect(resolvePublicHost(reader({ host: 'tenant-b.example:8443' }))).toBe(
      'tenant-b.example:8443',
    );
  });

  it('drops missing or malformed hosts', () => {
    expect(resolvePublicHost(reader({}))).toBeUndefined();
    expect(resolvePublicHost(reader({ host: 'evil.example\r\nx: y' }))).toBeUndefined();
    expect(resolvePublicHost(reader({ host: 'a/b' }))).toBeUndefined();
  });
});

describe('portal → gateway tenant forwarding (PRC-H113)', () => {
  // Stand-in for the gateway public resolver: tenant chosen from raw Host only.
  const tenants: Record<string, string[]> = {
    'tenant-a.example': ['Alpha Primary'],
    'tenant-b.example': ['Beta High', 'Beta Middle'],
  };
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const names = tenants[req.headers.host ?? ''];
      res.setHeader('content-type', 'application/json');
      if (!names) {
        res.statusCode = 404;
        res.end(
          JSON.stringify({
            code: 'PUBLIC_REGISTRATION_CONTEXT_NOT_FOUND',
            message: 'Registration portal is unavailable for this request',
            statusCode: 404,
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          data: names.map((name, i) => ({ id: `${i}`, name })),
          meta: { page: 1, pageSize: 50, totalItems: names.length, totalPages: 1 },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const viaPortal = (host: string) => (path: string, init?: Parameters<typeof gatewayRequest>[1]) =>
    gatewayRequest(path, init, {
      baseUrl,
      publicHost: resolvePublicHost(reader({ host })),
    });

  it('returns different institution lists for two tenant hostnames', async () => {
    const a = await getInstitutions({}, viaPortal('tenant-a.example'));
    const b = await getInstitutions({}, viaPortal('tenant-b.example'));
    expect(a.data.map((i) => i.name)).toEqual(['Alpha Primary']);
    expect(b.data.map((i) => i.name)).toEqual(['Beta High', 'Beta Middle']);
  });

  it('surfaces the not-found state for an unknown host instead of a default tenant', async () => {
    const error = await getInstitutions({}, viaPortal('unknown.example')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RegistrationApiError);
    expect((error as RegistrationApiError).statusCode).toBe(404);
    expect((error as RegistrationApiError).code).toBe('PUBLIC_REGISTRATION_CONTEXT_NOT_FOUND');
  });
});
