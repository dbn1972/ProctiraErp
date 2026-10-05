/**
 * PRC-M223 — invalid cron is rejected before persistence, and a legacy bad-cron
 * row no longer bricks the tenant's ETL endpoints.
 */
import { describe, expect, it } from 'vitest';

import { ETLService } from './etl-service.js';
import { InMemoryLogSink } from './execution-logger.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import type { CreatePipelineInput, Pipeline } from './schemas.js';
import { memoryConnectorFactory } from './test-support/memory-connector-factory.js';

const TENANT = 'tenant-m223';
const retryPolicy = { maxRetries: 0, backoffMs: 100 };
const input = (schedule?: string): CreatePipelineInput => ({
  name: `p-${schedule ?? 'none'}`,
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
  ...(schedule !== undefined ? { schedule } : {}),
});

function build(repository = new InMemoryPipelineRepository(), sink = new InMemoryLogSink()) {
  return new ETLService(repository, {
    defaultRetryPolicy: retryPolicy,
    testMode: true,
    logSink: sink,
    connectorFactory: memoryConnectorFactory(),
  });
}

describe('pipeline schedule validation (PRC-M223)', () => {
  it("create with schedule='abc' is a 400 and nothing is stored", async () => {
    const repository = new InMemoryPipelineRepository();
    const service = build(repository);
    await expect(service.createPipeline(TENANT, input('abc'))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect((await repository.list(TENANT, {}, 1, 10)).total).toBe(0);
  });

  it('update with an invalid schedule is a 400 and keeps the stored schedule', async () => {
    const service = build();
    const created = await service.createPipeline(TENANT, input('@daily'));
    await expect(
      service.updatePipeline(TENANT, created.id, { schedule: 'not a cron' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect((await service.getPipeline(TENANT, created.id)).schedule).toBe('@daily');
  });

  it('a seeded bad-cron row is skipped: list returns and other schedules register', async () => {
    const repository = new InMemoryPipelineRepository();
    const now = new Date();
    const base = {
      tenantId: TENANT,
      description: null,
      source: input().source,
      destination: input().destination,
      fieldMappings: input().fieldMappings,
      retryPolicy,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    await repository.create({
      ...base,
      id: '11111111-1111-4111-8111-111111111111',
      name: 'bad',
      schedule: 'abc',
    } as Pipeline);
    await repository.create({
      ...base,
      id: '22222222-2222-4222-8222-222222222222',
      name: 'good',
      schedule: '@hourly',
    } as Pipeline);
    const sink = new InMemoryLogSink();
    const service = build(repository, sink);

    const listed = await service.listPipelines(TENANT, {}, 1, 10);
    expect(listed.total).toBe(2);
    const scheduler = service.getScheduler();
    expect(scheduler.getSchedule('22222222-2222-4222-8222-222222222222')).toBeDefined();
    expect(scheduler.getSchedule('11111111-1111-4111-8111-111111111111')).toBeUndefined();
    expect(sink.entries.some((e) => e.message.startsWith('Schedule not registered'))).toBe(true);
    // Other endpoints keep working for the tenant.
    await expect(
      service.getPipeline(TENANT, '11111111-1111-4111-8111-111111111111'),
    ).resolves.toMatchObject({ name: 'bad' });
  });
});
