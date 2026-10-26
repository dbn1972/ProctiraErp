/**
 * PRC-L101 — cross-tenant isolation for ETL pipelines and executions.
 *
 * (a) InMemoryPipelineRepository: tenant A rows are invisible to tenant B.
 * (b) Routes: tenant B gets 404 / empty lists for tenant A's pipeline and executions.
 * (c) PgPipelineRepository: every statement binds the tenant GUC and carries a tenant predicate
 *     (statement shape only — live-Postgres RLS is not exercised here).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { ETLService } from './etl-service.js';
import { InMemoryLogSink } from './execution-logger.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import { PgPipelineRepository } from './pg-pipeline-repository.js';
import { registerETLRoutes } from './routes.js';
import type { CreatePipelineInput, Pipeline, PipelineExecution } from './schemas.js';
import { memoryConnectorFactory } from './test-support/memory-connector-factory.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const input: CreatePipelineInput = {
  name: 'tenant-a-pipeline',
  source: { type: 'csv', fileContent: 'a\n1\n', delimiter: ',', hasHeader: true },
  destination: {
    type: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'db',
    username: 'u',
    password: 'p',
    table: 't',
    writeMode: 'insert',
  },
  fieldMappings: [{ sourceField: 'a', destinationField: 'a' }],
};

function pipelineRow(id: string, tenantId: string): Pipeline {
  const now = new Date();
  return {
    id,
    tenantId,
    name: 'p',
    description: null,
    source: input.source,
    destination: input.destination,
    fieldMappings: input.fieldMappings,
    schedule: null,
    retryPolicy: { maxRetries: 0, backoffMs: 1 },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function executionRow(id: string, pipelineId: string, tenantId: string): PipelineExecution {
  return {
    id,
    pipelineId,
    tenantId,
    status: 'completed',
    startedAt: new Date(),
    completedAt: new Date(),
    extractedCount: 1,
    transformedCount: 1,
    loadedCount: 1,
    errorCount: 0,
    errors: [],
  };
}

describe('InMemoryPipelineRepository cross-tenant isolation (PRC-L101)', () => {
  let repo: InMemoryPipelineRepository;
  beforeEach(async () => {
    repo = new InMemoryPipelineRepository();
    await repo.create(pipelineRow('pipe-a', TENANT_A));
    await repo.createExecution(executionRow('exec-a', 'pipe-a', TENANT_A));
  });

  it('findById / list do not return another tenant pipeline', async () => {
    expect(await repo.findById('pipe-a', TENANT_B)).toBeNull();
    expect(await repo.list(TENANT_B, {}, 1, 50)).toEqual({ data: [], total: 0 });
    expect((await repo.list(TENANT_A, {}, 1, 50)).total).toBe(1);
  });

  it('update / delete refuse another tenant pipeline and leave it intact', async () => {
    await expect(repo.update('pipe-a', TENANT_B, { name: 'hijacked' })).rejects.toThrow(
      /not found/,
    );
    await expect(repo.delete('pipe-a', TENANT_B)).rejects.toThrow(/not found/);
    expect((await repo.findById('pipe-a', TENANT_A))?.name).toBe('p');
  });

  it('getExecution / listExecutions do not return another tenant execution', async () => {
    expect(await repo.getExecution('exec-a', TENANT_B)).toBeNull();
    expect(await repo.listExecutions('pipe-a', TENANT_B, 1, 50)).toEqual({ data: [], total: 0 });
    expect((await repo.listExecutions('pipe-a', TENANT_A, 1, 50)).total).toBe(1);
  });

  it("updateExecution refuses another tenant's execution and leaves it intact", async () => {
    const run: PipelineExecution = {
      ...executionRow('exec-idle', 'pipe-a', TENANT_A),
      status: 'running',
      completedAt: null,
    };
    expect(await repo.createExecutionIfIdle(run, new Date(0))).toBe(true);
    await expect(
      repo.updateExecution('exec-idle', { tenantId: TENANT_B, status: 'failed' }),
    ).rejects.toThrow(/Execution not found: exec-idle/);
    const own = await repo.getExecution('exec-idle', TENANT_A);
    expect(own?.tenantId).toBe(TENANT_A);
    expect(own?.status).toBe('running');
    expect(await repo.getExecution('exec-idle', TENANT_B)).toBeNull();
  });
});

describe('ETL routes cross-tenant isolation (PRC-L101)', () => {
  let app: FastifyInstance;
  let currentTenant = TENANT_A;

  beforeEach(async () => {
    currentTenant = TENANT_A;
    const service = new ETLService(new InMemoryPipelineRepository(), {
      defaultRetryPolicy: { maxRetries: 0, backoffMs: 1 },
      testMode: true,
      logSink: new InMemoryLogSink(),
      connectorFactory: memoryConnectorFactory(),
    });
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = currentTenant;
      (request as unknown as { user: unknown }).user = {
        sub: `user-${currentTenant}`,
        tenantId: currentTenant,
        roles: [{ roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null }],
      };
    });
    await registerETLRoutes(app, { etlService: service, prefix: '/pipelines' });
    await app.ready();
  });

  it("tenant B cannot read, change, run or list tenant A's pipeline", async () => {
    const created = await app.inject({ method: 'POST', url: '/pipelines', payload: input });
    expect(created.statusCode).toBe(201);
    const pipelineId = (JSON.parse(created.payload) as { id: string }).id;
    const run = await app.inject({ method: 'POST', url: `/pipelines/${pipelineId}/execute` });
    expect(run.statusCode).toBe(202);
    const executionId = (JSON.parse(run.payload) as { id: string }).id;

    currentTenant = TENANT_B;
    const list = await app.inject({ method: 'GET', url: '/pipelines' });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.payload)).toMatchObject({ data: [], meta: { total: 0 } });

    const attempts = [
      { method: 'GET' as const, url: `/pipelines/${pipelineId}` },
      { method: 'PUT' as const, url: `/pipelines/${pipelineId}`, payload: { name: 'hijacked' } },
      { method: 'POST' as const, url: `/pipelines/${pipelineId}/execute` },
      { method: 'GET' as const, url: `/pipelines/${pipelineId}/executions` },
      { method: 'GET' as const, url: `/pipelines/${pipelineId}/executions/${executionId}` },
      { method: 'DELETE' as const, url: `/pipelines/${pipelineId}` },
    ];
    for (const attempt of attempts) {
      const res = await app.inject(attempt);
      expect({ ...attempt, status: res.statusCode }).toEqual({ ...attempt, status: 404 });
    }

    // Tenant A's pipeline and run are untouched.
    currentTenant = TENANT_A;
    const own = await app.inject({ method: 'GET', url: `/pipelines/${pipelineId}` });
    expect(own.statusCode).toBe(200);
    expect(JSON.parse(own.payload).name).toBe('tenant-a-pipeline');
    const runs = await app.inject({ method: 'GET', url: `/pipelines/${pipelineId}/executions` });
    expect(JSON.parse(runs.payload).meta.total).toBe(1);
  });
});

describe('PgPipelineRepository tenant predicates (PRC-L101, statement shape)', () => {
  interface Recorded {
    text: string;
    values: unknown[];
  }

  function recordingPool() {
    const queries: Recorded[] = [];
    const client = {
      query: async (text: string, values: unknown[] = []) => {
        queries.push({ text, values });
        if (/COUNT\(\*\)/.test(text)) return { rows: [{ total: 0 }] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    return { queries, pool: { query: client.query, connect: async () => client } };
  }

  function dataStatements(queries: Recorded[]): Recorded[] {
    return queries.filter((q) => /etl_pipelines|etl_pipeline_runs/.test(q.text));
  }

  it('binds the tenant GUC and scopes every statement by tenant_id', async () => {
    const { queries, pool } = recordingPool();
    const repo = new PgPipelineRepository(pool as never);

    await repo.findById('pipe-a', TENANT_B);
    await repo.list(TENANT_B, { enabled: true, search: 'x' }, 1, 20);
    await repo.delete('pipe-a', TENANT_B);
    await repo.getExecution('exec-a', TENANT_B);
    await repo.listExecutions('pipe-a', TENANT_B, 1, 20);
    await expect(repo.update('pipe-a', TENANT_B, { name: 'x' })).rejects.toThrow(/not found/);
    await expect(
      repo.updateExecution('exec-a', { tenantId: TENANT_B, status: 'failed' }),
    ).rejects.toThrow(/not found/);

    const statements = dataStatements(queries);
    expect(statements.length).toBeGreaterThanOrEqual(8);
    for (const statement of statements) {
      expect(statement.text).toMatch(/tenant_id\s*=\s*\$\d/);
      expect(statement.values).toContain(TENANT_B);
      expect(statement.values).not.toContain(TENANT_A);
    }
    const gucBinds = queries.filter((q) => q.text.includes('set_config'));
    expect(gucBinds.length).toBeGreaterThanOrEqual(7);
    for (const bind of gucBinds) expect(bind.values).toEqual([TENANT_B]);
  });

  it('inserts carry the row tenant id under that tenant GUC', async () => {
    const { queries, pool } = recordingPool();
    const repo = new PgPipelineRepository(pool as never);
    await repo.create(pipelineRow('pipe-b', TENANT_B));
    await repo.createExecutionIfIdle(executionRow('exec-b', 'pipe-b', TENANT_B), new Date(0));

    const inserts = dataStatements(queries).filter((q) => q.text.includes('INSERT'));
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) expect(insert.values[1]).toBe(TENANT_B);
    for (const bind of queries.filter((q) => q.text.includes('set_config'))) {
      expect(bind.values).toEqual([TENANT_B]);
    }
  });
});
