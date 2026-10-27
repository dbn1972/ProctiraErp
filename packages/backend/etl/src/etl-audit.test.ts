/**
 * PRC-L302 — pipeline create/update/delete/execute emit audit events.
 *
 * One event per successful mutation carrying tenant, actor, action and resource ids; no
 * connector config, credentials, field mappings or rows.
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { ETLService, type ETLServiceConfig } from './etl-service.js';
import { InMemoryLogSink } from './execution-logger.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import { registerETLRoutes } from './routes.js';
import type { CreatePipelineInput } from './schemas.js';
import { memoryConnectorFactory } from './test-support/memory-connector-factory.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

interface CapturedEvent {
  tenantId: string;
  actorId: string | null;
  action: string;
  pipelineId: string;
  executionId: string | null;
  outcome?: string;
  occurredAt: Date;
}

const input = (overrides: Partial<CreatePipelineInput> = {}): CreatePipelineInput => ({
  name: 'audited',
  source: { type: 'csv', fileContent: 'a\n1\n', delimiter: ',', hasHeader: true },
  destination: {
    type: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'db',
    username: 'u',
    password: 'super-secret-password',
    table: 't',
    writeMode: 'insert',
  },
  fieldMappings: [{ sourceField: 'a', destinationField: 'a' }],
  ...overrides,
});

function build(logSink = new InMemoryLogSink()) {
  const events: CapturedEvent[] = [];
  const config = {
    defaultRetryPolicy: { maxRetries: 0, backoffMs: 1 },
    testMode: true,
    logSink,
    connectorFactory: memoryConnectorFactory(),
    auditSink: (event: CapturedEvent) => {
      events.push(event);
    },
  } as ETLServiceConfig;
  const service = new ETLService(new InMemoryPipelineRepository(), config);
  return { service, events, logSink };
}

describe('ETL audit events (PRC-L302)', () => {
  it('create/update/delete/execute each emit exactly one event', async () => {
    const { service, events } = build();
    const ctx = { actorId: 'user-1' };
    const created = await service.createPipeline(TENANT, input(), ctx);
    await service.updatePipeline(TENANT, created.id, { name: 'renamed' }, ctx);
    const run = await service.executePipeline(TENANT, created.id, ctx);
    await service.deletePipeline(TENANT, created.id, ctx);

    expect(events.map((e) => e.action)).toEqual([
      'pipeline.create',
      'pipeline.update',
      'pipeline.execute',
      'pipeline.delete',
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ tenantId: TENANT, actorId: 'user-1', pipelineId: created.id });
      expect(event.occurredAt).toBeInstanceOf(Date);
    }
    expect(events[2]).toMatchObject({ executionId: run.id, outcome: 'completed' });
    expect(events[0]!.executionId).toBeNull();
  });

  it('a rejected create (invalid cron) emits nothing', async () => {
    const { service, events } = build();
    await expect(
      service.createPipeline(TENANT, input({ schedule: 'abc' }), { actorId: 'user-1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(events).toHaveLength(0);
  });

  it('scheduled (retry) execution emits with a null actor', async () => {
    const { service, events } = build();
    const created = await service.createPipeline(TENANT, input());
    events.length = 0;
    const run = await service.executePipelineWithRetry(TENANT, created.id, true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'pipeline.execute',
      actorId: null,
      executionId: run.id,
      outcome: run.status,
    });
  });

  it('events never carry connector config, credentials or mappings', async () => {
    const { service, events } = build();
    const created = await service.createPipeline(TENANT, input(), { actorId: 'user-1' });
    await service.executePipeline(TENANT, created.id, { actorId: 'user-1' });
    const serialized = JSON.stringify(events);
    expect(events.length).toBeGreaterThan(0);
    expect(serialized).not.toContain('super-secret-password');
    expect(serialized).not.toMatch(/password|connectionString|fileContent|fieldMappings/);
  });

  it('default sink writes one audit entry per mutation to the service log sink', async () => {
    const logSink = new InMemoryLogSink();
    const service = new ETLService(new InMemoryPipelineRepository(), {
      defaultRetryPolicy: { maxRetries: 0, backoffMs: 1 },
      testMode: true,
      logSink,
      connectorFactory: memoryConnectorFactory(),
    });
    const created = await service.createPipeline(TENANT, input(), { actorId: 'user-1' });
    const audit = logSink.entries.filter((e) => (e.phase as string) === 'audit');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tenantId: TENANT, pipelineId: created.id });
    expect(audit[0]!.metadata).toMatchObject({ action: 'pipeline.create', actorId: 'user-1' });
    expect(JSON.stringify(audit)).not.toContain('super-secret-password');
  });

  it('default sink carries tenant/pipeline/execution ids in metadata (ConsoleLogSink prints only message + metadata)', async () => {
    const logSink = new InMemoryLogSink();
    const service = new ETLService(new InMemoryPipelineRepository(), {
      defaultRetryPolicy: { maxRetries: 0, backoffMs: 1 },
      testMode: true,
      logSink,
      connectorFactory: memoryConnectorFactory(),
    });
    const created = await service.createPipeline(TENANT, input(), { actorId: 'user-1' });
    const run = await service.executePipeline(TENANT, created.id, { actorId: 'user-1' });
    const audit = logSink.entries.filter((e) => (e.phase as string) === 'audit');
    expect(audit.map((e) => e.metadata)).toEqual([
      {
        action: 'pipeline.create',
        actorId: 'user-1',
        tenantId: TENANT,
        pipelineId: created.id,
        executionId: null,
      },
      {
        action: 'pipeline.execute',
        actorId: 'user-1',
        tenantId: TENANT,
        pipelineId: created.id,
        executionId: run.id,
        outcome: 'completed',
      },
    ]);
  });

  it('a failed execution emits one pipeline.execute event with outcome failed', async () => {
    const events: CapturedEvent[] = [];
    const failingSink = {
      load: async () => {
        throw new Error('destination unavailable');
      },
      validate: async () => ({ valid: true }),
    };
    const service = new ETLService(new InMemoryPipelineRepository(), {
      defaultRetryPolicy: { maxRetries: 0, backoffMs: 1 },
      testMode: true,
      logSink: new InMemoryLogSink(),
      connectorFactory: memoryConnectorFactory(failingSink),
      auditSink: (event: CapturedEvent) => {
        events.push(event);
      },
    } as ETLServiceConfig);
    const created = await service.createPipeline(TENANT, input(), { actorId: 'user-1' });
    events.length = 0;
    await expect(
      service.executePipeline(TENANT, created.id, { actorId: 'user-1' }),
    ).rejects.toThrow('destination unavailable');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'pipeline.execute',
      tenantId: TENANT,
      actorId: 'user-1',
      pipelineId: created.id,
      outcome: 'failed',
    });
    expect(events[0]!.executionId).toEqual(expect.any(String));
  });

  it('a retry-path execution that throws still emits one pipeline.execute event and rethrows', async () => {
    const events: CapturedEvent[] = [];
    const service = new ETLService(new InMemoryPipelineRepository(), {
      defaultRetryPolicy: { maxRetries: 0, backoffMs: 1 },
      testMode: true,
      logSink: new InMemoryLogSink(),
      connectorFactory: memoryConnectorFactory(),
      eventPublisher: {
        publish: async (event: { eventType?: string; type?: string }) => {
          throw new Error(`event bus down (${event.eventType ?? event.type ?? 'event'})`);
        },
      },
      auditSink: (event: CapturedEvent) => {
        events.push(event);
      },
    } as unknown as ETLServiceConfig);
    const created = await service.createPipeline(TENANT, input(), { actorId: 'user-1' });
    events.length = 0;
    await expect(
      service.executePipelineWithRetry(TENANT, created.id, false, { actorId: 'user-1' }),
    ).rejects.toThrow(/event bus down/);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'pipeline.execute',
      tenantId: TENANT,
      actorId: 'user-1',
      pipelineId: created.id,
    });
    expect(events[0]!.executionId).toEqual(expect.any(String));
  });

  it('an audit sink failure never masks the original execution error', async () => {
    const logSink = new InMemoryLogSink();
    const failingSink = {
      load: async () => {
        throw new Error('destination unavailable');
      },
      validate: async () => ({ valid: true }),
    };
    let auditCalls = 0;
    const service = new ETLService(new InMemoryPipelineRepository(), {
      defaultRetryPolicy: { maxRetries: 0, backoffMs: 1 },
      testMode: true,
      logSink,
      connectorFactory: memoryConnectorFactory(failingSink),
      eventPublisher: {
        publish: async () => {
          throw new Error('event bus down');
        },
      },
      auditSink: (event: CapturedEvent) => {
        if (event.action === 'pipeline.execute') {
          auditCalls += 1;
          throw new Error('audit store down');
        }
      },
    } as unknown as ETLServiceConfig);
    const retried = await service.createPipeline(TENANT, input({ name: 'retry-path' }));
    const direct = await service.createPipeline(TENANT, input({ name: 'direct-path' }));
    await expect(service.executePipelineWithRetry(TENANT, retried.id)).rejects.toThrow(
      'event bus down',
    );
    await expect(service.executePipeline(TENANT, direct.id)).rejects.toThrow(
      'destination unavailable',
    );
    expect(auditCalls).toBe(2);
    expect(
      logSink
        .getByPhase('audit')
        .filter((e) => e.level === 'error' && /audit store down/.test(e.message)),
    ).toHaveLength(2);
  });

  it('routes pass the JWT subject as the actor', async () => {
    const { service, events } = build();
    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: unknown }).user = {
        sub: 'jwt-subject-42',
        tenantId: TENANT,
        roles: [{ roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null }],
      };
    });
    await registerETLRoutes(app, { etlService: service, prefix: '/pipelines' });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/pipelines', payload: input() });
    expect(res.statusCode).toBe(201);
    const { id } = JSON.parse(res.payload) as { id: string };
    await app.inject({ method: 'POST', url: `/pipelines/${id}/execute` });
    await app.inject({ method: 'PUT', url: `/pipelines/${id}`, payload: { name: 'x' } });
    await app.inject({ method: 'DELETE', url: `/pipelines/${id}` });
    expect(events.map((e) => [e.action, e.actorId])).toEqual([
      ['pipeline.create', 'jwt-subject-42'],
      ['pipeline.execute', 'jwt-subject-42'],
      ['pipeline.update', 'jwt-subject-42'],
      ['pipeline.delete', 'jwt-subject-42'],
    ]);
    await app.close();
  });
});
