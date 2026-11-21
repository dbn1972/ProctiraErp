/**
 * UAT-9d (#718 review follow-ups 1 and 2): a refused report download records WHY it was
 * refused (malformed, expired, bad signature, missing signing key) instead of one
 * `token_invalid` bucket, while the HTTP body stays identical for every token failure (no
 * oracle). Repeated denials for the same (tenant, actor, artifact, reason) inside 60 s write
 * one audit row; the suppressed repeats are counted on the next row for that key. Successful
 * downloads are never coalesced.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { RecordingReportAuditPort } from './report-audit.js';
import { InMemoryReportStore } from './report-store.js';
const TENANT = '00000000-0000-4000-8000-00000000a0a0';
const ACTOR = 'principal-a';
const DENIED = 'report.download.denied';
const apps: FastifyInstance[] = [];
const savedDemo = process.env.REPORT_DEMO_DATA;
beforeAll(() => {
  process.env.REPORT_DEMO_DATA = '1';
});
afterAll(() => {
  if (savedDemo === undefined) delete process.env.REPORT_DEMO_DATA;
  else process.env.REPORT_DEMO_DATA = savedDemo;
});
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});
interface Setup {
  app: FastifyInstance;
  audit: RecordingReportAuditPort;
  clock: { now: number };
  artifactId: string;
  path: string;
}
async function setup(maxKeys?: number): Promise<Setup> {
  const audit = new RecordingReportAuditPort();
  const clock = { now: 1_800_000_000_000 };
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { user: unknown }).user = {
      sub: ACTOR,
      tenantId: TENANT,
      roles: [{ roleId: 'principal', roleName: 'principal' }],
    };
  });
  await app.register(reportCataloguePlugin, {
    store: new InMemoryReportStore(),
    blobStore: new InMemoryReportBlobStore(),
    disableScheduler: true,
    audit,
    denialAudit: { now: () => clock.now, ...(maxKeys ? { maxKeys } : {}) },
  });
  await app.ready();
  const gen = await app.inject({
    method: 'POST',
    url: '/reports/generate',
    payload: { reportKey: 'students_roster', format: 'CSV' },
  });
  expect(gen.statusCode).toBe(201);
  const { artifactId, downloadUrl } = gen.json() as { artifactId: string; downloadUrl: string };
  audit.events.length = 0;
  return { app, audit, clock, artifactId, path: downloadUrl.replace('/api/v1', '') };
}
function withToken(path: string, token: string): string {
  return path.replace(/token=[^&]*/, `token=${encodeURIComponent(token)}`);
}
function denials(audit: RecordingReportAuditPort) {
  return audit.events.filter((e) => e.action === DENIED);
}
describe('report download denial reasons (UAT-9d)', () => {
  it('records the specific token failure while every body is identical', async () => {
    const { app, audit, path, artifactId } = await setup();
    const exp = new URL(`http://x${path}`).searchParams.get('token')!.split('.')[0]!;
    const pastExp = Math.floor(Date.now() / 1000) - 60;
    const cases: Array<[string, string]> = [
      ['garbage', 'token_malformed'],
      [`${pastExp}.abcdef`, 'token_expired'],
      [`${exp}.${'0'.repeat(64)}`, 'token_signature_invalid'],
    ];
    const bodies = new Set<string>();
    for (const [token, reason] of cases) {
      const res = await app.inject({ method: 'GET', url: withToken(path, token) });
      expect(res.statusCode).toBe(403);
      bodies.add(res.body);
      expect(denials(audit).at(-1)).toMatchObject({ artifactId, reason });
    }
    expect(bodies.size).toBe(1);
    expect(denials(audit).map((e) => e.reason)).toEqual([
      'token_malformed',
      'token_expired',
      'token_signature_invalid',
    ]);
  });
});
describe('report download denial audit coalescing (UAT-9d)', () => {
  it('writes one row per key per 60 s and counts the suppressed repeats on the next row', async () => {
    const { app, audit, clock, path } = await setup();
    const forged = withToken(path, '9999999999.forged');
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({ method: 'GET', url: forged });
      expect(res.statusCode).toBe(403);
      clock.now += 1_000;
    }
    expect(denials(audit)).toHaveLength(1);
    expect(denials(audit)[0]!.suppressedCount).toBeUndefined();
    clock.now += 60_000;
    await app.inject({ method: 'GET', url: forged });
    expect(denials(audit)).toHaveLength(2);
    expect(denials(audit)[1]).toMatchObject({
      reason: 'token_signature_invalid',
      suppressedCount: 4,
    });
  });
  it('keeps keys with a different reason or artifact separate', async () => {
    const { app, audit, path } = await setup();
    await app.inject({ method: 'GET', url: withToken(path, '9999999999.forged') });
    await app.inject({ method: 'GET', url: withToken(path, 'garbage') });
    await app.inject({ method: 'GET', url: path.replace(/\?.*$/, '') });
    const other = path.replace(
      /artifacts\/[^/]+/,
      'artifacts/00000000-0000-4000-8000-0000000000ff',
    );
    await app.inject({ method: 'GET', url: other });
    expect(denials(audit).map((e) => e.reason)).toEqual([
      'token_signature_invalid',
      'token_malformed',
      'token_missing',
      'artifact_not_found',
    ]);
  });
  it('bounds the in-memory keys (LRU): an evicted key records again', async () => {
    const { app, audit, path } = await setup(2);
    await app.inject({ method: 'GET', url: withToken(path, '9999999999.forged') }); // key 1
    await app.inject({ method: 'GET', url: withToken(path, 'garbage') }); // key 2
    await app.inject({ method: 'GET', url: path.replace(/\?.*$/, '') }); // key 3 evicts key 1
    await app.inject({ method: 'GET', url: withToken(path, '9999999999.forged') }); // key 1 again
    expect(denials(audit).map((e) => e.reason)).toEqual([
      'token_signature_invalid',
      'token_malformed',
      'token_missing',
      'token_signature_invalid',
    ]);
  });
  it('never coalesces successful downloads', async () => {
    const { app, audit, path } = await setup();
    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(200);
    }
    expect(audit.events.filter((e) => e.action === 'report.download')).toHaveLength(3);
  });
});
