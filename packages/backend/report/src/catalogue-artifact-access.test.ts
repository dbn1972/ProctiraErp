/**
 * PRC-M631: HTTP coverage for role-based and cross-user artifact access on the
 * report catalogue (GET /reports/artifacts/:id, its download, and the
 * GET /reports/runs visibility filter). Test-only: asserts current behaviour.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { InMemoryReportStore } from './report-store.js';

const TENANT = '00000000-0000-4000-8000-0000000006c1';
const headers = { 'x-tenant-id': TENANT };

interface Shared {
  store: InMemoryReportStore;
  blobs: InMemoryReportBlobStore;
}

const apps: FastifyInstance[] = [];
const savedDemo = process.env.REPORT_DEMO_DATA;

beforeAll(() => {
  // No DB pool in unit tests: providers must be explicitly opted into demo rows (PRC-H080).
  process.env.REPORT_DEMO_DATA = '1';
});

afterAll(() => {
  if (savedDemo === undefined) delete process.env.REPORT_DEMO_DATA;
  else process.env.REPORT_DEMO_DATA = savedDemo;
});

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

function newShared(): Shared {
  return { store: new InMemoryReportStore(), blobs: new InMemoryReportBlobStore() };
}

async function appAs(roles: string[], sub: string, shared: Shared): Promise<FastifyInstance> {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { user: unknown }).user = {
      sub,
      roles: roles.map((r) => ({ roleId: r, roleName: r })),
    };
  });
  await app.register(reportCataloguePlugin, {
    store: shared.store,
    blobStore: shared.blobs,
    disableScheduler: true,
  });
  await app.ready();
  return app;
}

async function generate(
  shared: Shared,
  roles: string[],
  sub: string,
  reportKey: string,
): Promise<{ artifactId: string; downloadUrl: string }> {
  const app = await appAs(roles, sub, shared);
  const res = await app.inject({
    method: 'POST',
    url: '/reports/generate',
    headers,
    payload: { reportKey, format: 'CSV' },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { artifactId: string; downloadUrl: string };
}

async function getArtifact(app: FastifyInstance, id: string) {
  return app.inject({ method: 'GET', url: `/reports/artifacts/${id}`, headers });
}

describe('PRC-M631 artifact metadata access by role and owner', () => {
  it('lets the owning teacher read their own students_roster artifact', async () => {
    const shared = newShared();
    const { artifactId } = await generate(shared, ['teacher'], 'teacher-a', 'students_roster');
    const owner = await appAs(['teacher'], 'teacher-a', shared);

    const res = await getArtifact(owner, artifactId);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: artifactId, requestedBy: 'teacher-a' });
  });

  it('hides the artifact (404) from another teacher with the same role', async () => {
    const shared = newShared();
    const { artifactId } = await generate(shared, ['teacher'], 'teacher-a', 'students_roster');
    const other = await appAs(['teacher'], 'teacher-b', shared);

    const res = await getArtifact(other, artifactId);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets a principal (report manager) read any artifact', async () => {
    const shared = newShared();
    const { artifactId } = await generate(shared, ['teacher'], 'teacher-a', 'students_roster');
    const principal = await appAs(['principal'], 'principal-1', shared);

    const res = await getArtifact(principal, artifactId);

    expect(res.statusCode).toBe(200);
  });

  it('hides a students_roster artifact (404) from a fees_clerk, who is not entitled', async () => {
    const shared = newShared();
    const { artifactId } = await generate(shared, ['teacher'], 'teacher-a', 'students_roster');
    const clerk = await appAs(['fees_clerk'], 'clerk-1', shared);

    const res = await getArtifact(clerk, artifactId);

    expect(res.statusCode).toBe(404);
  });

  it('denies a parent (403) on artifacts and runs', async () => {
    const shared = newShared();
    const { artifactId } = await generate(shared, ['teacher'], 'teacher-a', 'students_roster');
    const parent = await appAs(['parent'], 'parent-1', shared);

    const artifact = await getArtifact(parent, artifactId);
    const runs = await parent.inject({ method: 'GET', url: '/reports/runs', headers });

    expect(artifact.statusCode).toBe(403);
    expect(runs.statusCode).toBe(403);
  });
});

describe('PRC-M631 signed download across users', () => {
  it('serves the owner and a principal but not another teacher on the same signed URL', async () => {
    const shared = newShared();
    await generate(shared, ['teacher'], 'teacher-a', 'students_roster');
    const ownerApp = await appAs(['teacher'], 'teacher-a', shared);
    const runs = await ownerApp.inject({ method: 'GET', url: '/reports/runs', headers });
    const [run] = (runs.json() as { data: Array<{ artifactId: string }> }).data;
    const meta = await getArtifact(ownerApp, run!.artifactId);
    const path = (meta.json() as { downloadUrl: string }).downloadUrl.replace('/api/v1', '');

    const owner = await ownerApp.inject({ method: 'GET', url: path, headers });
    const other = await (
      await appAs(['teacher'], 'teacher-b', shared)
    ).inject({ method: 'GET', url: path, headers });
    const principal = await (
      await appAs(['principal'], 'principal-1', shared)
    ).inject({ method: 'GET', url: path, headers });

    expect(owner.statusCode).toBe(200);
    expect(other.statusCode).toBe(404);
    expect(principal.statusCode).toBe(200);
  });
});

describe('PRC-M631 GET /reports/runs visibility', () => {
  it('hides runs of report keys the caller is not entitled to; managers see all', async () => {
    const shared = newShared();
    await generate(shared, ['teacher'], 'teacher-a', 'students_roster');
    await generate(shared, ['fees_clerk'], 'clerk-1', 'fee_dues');

    const templateIds = async (roles: string[], sub: string) => {
      const app = await appAs(roles, sub, shared);
      const res = await app.inject({ method: 'GET', url: '/reports/runs', headers });
      expect(res.statusCode).toBe(200);
      return (res.json() as { data: Array<{ templateId: string }> }).data
        .map((r) => r.templateId)
        .sort();
    };

    const teacher = await templateIds(['teacher'], 'teacher-b');
    const clerk = await templateIds(['fees_clerk'], 'clerk-2');
    const principal = await templateIds(['principal'], 'principal-1');

    expect(teacher).toHaveLength(1);
    expect(clerk).toHaveLength(1);
    expect(teacher).not.toEqual(clerk);
    expect(principal).toHaveLength(2);
    expect(principal).toEqual([...teacher, ...clerk].sort());
  });
});
