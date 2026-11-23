/**
 * PRC-L338 (topic 1): report download links must mint a FRESH short-lived
 * token per link and build an ABSOLUTE URL from a trusted public base
 * (configuration, never request-derived). A relative or Host-derived link lets
 * an unauthenticated follower be pointed at an attacker-chosen host instead of
 * the real (absolute) auth page.
 *
 * Approved option (design.md topic 1): "report links mint a fresh token and
 * point to the absolute auth page."
 *
 * Failing-first: on the base source the catalogue returns a relative
 * `/api/v1/reports/...` downloadUrl regardless of configuration, so the
 * trusted-base / absolute-URL assertions fail.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { InMemoryReportStore } from './report-store.js';

const TENANT = '00000000-0000-4000-8000-0000000006c1';
const headers = { 'x-tenant-id': TENANT };
const TRUSTED_BASE = 'https://reports.example.test';

const apps: FastifyInstance[] = [];
const savedDemo = process.env.REPORT_DEMO_DATA;
const savedPublicApi = process.env.PUBLIC_API_BASE_URL;
const savedPublicBase = process.env.PUBLIC_BASE_URL;

beforeAll(() => {
  process.env.REPORT_DEMO_DATA = '1';
});

afterAll(() => {
  if (savedDemo === undefined) delete process.env.REPORT_DEMO_DATA;
  else process.env.REPORT_DEMO_DATA = savedDemo;
  if (savedPublicApi === undefined) delete process.env.PUBLIC_API_BASE_URL;
  else process.env.PUBLIC_API_BASE_URL = savedPublicApi;
  if (savedPublicBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = savedPublicBase;
});

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

interface Shared {
  store: InMemoryReportStore;
  blobs: InMemoryReportBlobStore;
}

function newShared(): Shared {
  return { store: new InMemoryReportStore(), blobs: new InMemoryReportBlobStore() };
}

async function appAs(
  roles: string[],
  sub: string,
  shared: Shared,
  publicApiBaseUrl?: string,
): Promise<FastifyInstance> {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { user: unknown }).user = {
      sub,
      tenantId: TENANT,
      roles: roles.map((r) => ({ roleId: r, roleName: r })),
    };
  });
  await app.register(reportCataloguePlugin, {
    store: shared.store,
    blobStore: shared.blobs,
    disableScheduler: true,
    publicApiBaseUrl,
  });
  await app.ready();
  return app;
}

async function generate(app: FastifyInstance, reportKey: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/reports/generate',
    headers,
    payload: { reportKey, format: 'CSV' },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { artifactId: string }).artifactId;
}

async function downloadUrl(app: FastifyInstance, id: string): Promise<string> {
  const res = await app.inject({ method: 'GET', url: `/reports/artifacts/${id}`, headers });
  expect(res.statusCode).toBe(200);
  return (res.json() as { downloadUrl: string }).downloadUrl;
}

describe('PRC-L338 report download link is absolute, trusted-base and fresh-token', () => {
  it('builds an ABSOLUTE url from the configured trusted public base', async () => {
    const shared = newShared();
    const app = await appAs(['teacher'], 'teacher-a', shared, TRUSTED_BASE);
    const id = await generate(app, 'students_roster');

    const url = await downloadUrl(app, id);

    const parsed = new URL(url); // throws if not absolute
    expect(parsed.origin).toBe(TRUSTED_BASE);
    expect(parsed.pathname).toBe(`/api/v1/reports/artifacts/${id}/download`);
    expect(parsed.searchParams.get('token')).toBeTruthy();
  });

  it('reads the trusted base from PUBLIC_API_BASE_URL (configuration, not request-derived)', async () => {
    process.env.PUBLIC_API_BASE_URL = TRUSTED_BASE;
    delete process.env.PUBLIC_BASE_URL;
    const shared = newShared();
    const app = await appAs(['teacher'], 'teacher-a', shared);
    const id = await generate(app, 'students_roster');

    const url = await downloadUrl(app, id);

    expect(new URL(url).origin).toBe(TRUSTED_BASE);
    delete process.env.PUBLIC_API_BASE_URL;
  });

  it('ignores a request Host header: the link never uses the request host', async () => {
    process.env.PUBLIC_API_BASE_URL = TRUSTED_BASE;
    const shared = newShared();
    const app = await appAs(['teacher'], 'teacher-a', shared);
    const id = await generate(app, 'students_roster');

    const res = await app.inject({
      method: 'GET',
      url: `/reports/artifacts/${id}`,
      headers: {
        ...headers,
        host: 'attacker.evil.example',
        'x-forwarded-host': 'attacker.evil.example',
      },
    });
    expect(res.statusCode).toBe(200);
    const url = (res.json() as { downloadUrl: string }).downloadUrl;
    expect(new URL(url).origin).toBe(TRUSTED_BASE);
    expect(url).not.toContain('attacker.evil.example');
    delete process.env.PUBLIC_API_BASE_URL;
  });

  it('mints a FRESH token on each link (no reuse of a stale token)', async () => {
    process.env.PUBLIC_API_BASE_URL = TRUSTED_BASE;
    const shared = newShared();
    const app = await appAs(['teacher'], 'teacher-a', shared);
    const id = await generate(app, 'students_roster');

    const first = new URL(await downloadUrl(app, id)).searchParams.get('token');
    await new Promise((r) => setTimeout(r, 1100)); // token exp is per-second; ensure a new value
    const second = new URL(await downloadUrl(app, id)).searchParams.get('token');

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    delete process.env.PUBLIC_API_BASE_URL;
  });

  it('falls back to a relative /api/v1 path when no trusted base is configured (no request-derived host)', async () => {
    delete process.env.PUBLIC_API_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    const shared = newShared();
    const app = await appAs(['teacher'], 'teacher-a', shared);
    const id = await generate(app, 'students_roster');

    const url = await downloadUrl(app, id);

    expect(url.startsWith(`/api/v1/reports/artifacts/${id}/download`)).toBe(true);
    expect(() => new URL(url)).toThrow(); // relative, so not an absolute URL
  });
});
