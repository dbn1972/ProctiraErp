/**
 * PRC-L143: GET /reports/runs resolves artifacts with one batched lookup
 * instead of one store call (and one tenant transaction) per run.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

vi.mock('@proctira/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/database')>();
  return {
    ...actual,
    getSharedPgPool: () => null,
    createDatabaseSchemaReadinessCheck: () => async () => undefined,
    withPgTenant: async (
      pool: { query: QueryFn },
      _tenantId: string,
      fn: (client: { query: QueryFn }) => Promise<unknown>,
    ) => fn(pool),
  };
});

const { InMemoryReportBlobStore } = await import('./blob-store.js');
const { reportCataloguePlugin } = await import('./catalogue-plugin.js');
const { CatalogueService } = await import('./catalogue-service.js');
const { PgReportStore } = await import('./pg-report-store.js');
const { InMemoryReportStore } = await import('./report-store.js');

const TENANT = '00000000-0000-4000-8000-0000000001a3';
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function seed(store: InstanceType<typeof InMemoryReportStore>) {
  const createdAt = new Date('2026-03-01T08:00:00.000Z');
  for (let i = 1; i <= 5; i++) {
    const hasArtifact = i <= 3;
    if (hasArtifact) {
      await store.insertArtifact({
        id: uuid(100 + i),
        tenantId: TENANT,
        reportKey: 'students_roster',
        format: 'csv',
        objectKey: `obj-${i}`,
        sha256: 'a'.repeat(64),
        sizeBytes: 2048 * i,
        requestedBy: 'principal-1',
        createdAt,
      });
    }
    await store.insertRun({
      id: uuid(200 + i),
      tenantId: TENANT,
      scheduleId: null,
      artifactId: hasArtifact ? uuid(100 + i) : null,
      reportKey: 'students_roster',
      format: 'csv',
      source: 'manual',
      status: hasArtifact ? 'completed' : 'failed',
      sha256: null,
      objectKey: null,
      sizeBytes: null,
      error: hasArtifact ? null : 'boom',
      createdAt: new Date(createdAt.getTime() + i * 1000),
      completedAt: null,
    });
  }
}

async function buildApp(store: InstanceType<typeof InMemoryReportStore>, logLines?: string[]) {
  const app = logLines
    ? Fastify({
        logger: { level: 'warn', stream: { write: (line: string) => logLines.push(line) } },
      })
    : Fastify();
  apps.push(app);
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { user: unknown }).user = {
      sub: 'principal-1',
      roles: [{ roleId: 'principal', roleName: 'principal' }],
    };
  });
  await app.register(reportCataloguePlugin, {
    store,
    blobStore: new InMemoryReportBlobStore(),
    disableScheduler: true,
  });
  await app.ready();
  return app;
}

describe('PRC-L143 GET /reports/runs artifact lookup', () => {
  it('fetches artifacts once in a batch and never per run', async () => {
    const store = new InMemoryReportStore();
    await seed(store);
    const app = await buildApp(store);
    const single = vi.spyOn(store, 'getArtifact');
    const batch = vi.spyOn(store, 'getArtifactsByIds');

    const res = await app.inject({
      method: 'GET',
      url: '/reports/runs',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    expect(single).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]![0]).toBe(TENANT);
    expect([...batch.mock.calls[0]![1]].sort()).toEqual([uuid(101), uuid(102), uuid(103)]);
  });

  it('returns the same payload the per-run lookup produced', async () => {
    const store = new InMemoryReportStore();
    await seed(store);
    const app = await buildApp(store);

    const res = await app.inject({
      method: 'GET',
      url: '/reports/runs',
      headers: { 'x-tenant-id': TENANT },
    });

    // Reference: the pre-change shape, built with one getArtifact per run.
    const service = new CatalogueService(store, new InMemoryReportBlobStore());
    const runs = await service.listRuns(TENANT, {});
    const expected = await Promise.all(
      runs.map(async (run) =>
        service.toInsightsRunFromRecords(
          run,
          run.artifactId ? await store.getArtifact(TENANT, run.artifactId) : null,
          'principal-1',
        ),
      ),
    );
    const body = res.json() as { data: Array<{ artifactId: string | null }> };
    expect(body.data).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(body.data.filter((r) => r.artifactId !== null)).toHaveLength(3);
  });

  it('logs a failed batch lookup and still lists the runs without artifacts', async () => {
    const store = new InMemoryReportStore();
    await seed(store);
    const logLines: string[] = [];
    const app = await buildApp(store, logLines);
    vi.spyOn(store, 'getArtifactsByIds').mockRejectedValueOnce(new Error('pg down'));
    const res = await app.inject({
      method: 'GET',
      url: '/reports/runs',
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ artifactId: string | null }> };
    expect(body.data).toHaveLength(5);
    expect(body.data.every((r) => r.artifactId === null)).toBe(true);
    const warned = logLines.filter((line) => line.includes('batched artifact lookup failed'));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('pg down');
  });
});

describe('PRC-L143 PgReportStore.getArtifactsByIds', () => {
  it('issues one tenant-scoped ANY($2::uuid[]) query and maps rows', async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return {
          rows: [
            {
              id: uuid(101),
              tenant_id: TENANT,
              report_key: 'students_roster',
              format: 'csv',
              object_key: 'obj-1',
              sha256: 'b'.repeat(64),
              size_bytes: '4096',
              requested_by: 'principal-1',
              created_at: '2026-03-01T08:00:00.000Z',
            },
          ],
        };
      },
    };
    const store = new PgReportStore(pool);

    const result = await store.getArtifactsByIds(TENANT, [uuid(101), uuid(102)]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toMatch(/FROM report_artifacts/);
    expect(calls[0]!.text).toMatch(/tenant_id = \$1/);
    expect(calls[0]!.text).toMatch(/id = ANY\(\$2::uuid\[\]\)/);
    expect(calls[0]!.values).toEqual([TENANT, [uuid(101), uuid(102)]]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: uuid(101), tenantId: TENANT, sizeBytes: 4096 });
    expect(result[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('skips the query entirely for an empty id list', async () => {
    const query = vi.fn();
    const store = new PgReportStore({ query });
    await expect(store.getArtifactsByIds(TENANT, [])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
