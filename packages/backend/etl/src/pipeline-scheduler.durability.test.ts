/**
 * W2-JOB-05: ETL pipeline scheduler durability across process restart.
 *
 * Tip verification (CONFIRMED):
 *   pipeline-scheduler.ts keeps schedules in a process-local Map + setInterval.
 *   etl-service createPipeline registers into that Map only — a new ETLService
 *   against the same durable repository has an empty scheduler.
 *
 * Fix: hydrateSchedules(tenantId) rebuilds the Map from repository rows;
 *   ensureSchedulesHydrated runs on mutating / execute / list entry points.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { ETLService } from './etl-service.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import type { CreatePipelineInput } from './schemas.js';

const TENANT_ID = 'tenant-etl-sched';

const defaultConfig = {
  defaultRetryPolicy: { maxRetries: 3, backoffMs: 1000 },
  testMode: true as const,
};

const baseInput: CreatePipelineInput = {
  name: 'Test',
  source: {
    type: 'csv',
    fileContent: 'name,age\nJohn,30',
    hasHeader: true,
  },
  destination: {
    type: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    username: 'user',
    password: 'pass',
    table: 'users',
  },
  fieldMappings: [{ sourceField: 'name', destinationField: 'full_name' }],
};

describe('W2-JOB-05 ETL scheduler durability', () => {
  let repository: InMemoryPipelineRepository;

  beforeEach(() => {
    repository = new InMemoryPipelineRepository();
  });

  it('CONFIRMED tip: new process loses in-memory schedules despite durable pipelines', async () => {
    const service1 = new ETLService(repository, defaultConfig);
    const pipeline = await service1.createPipeline(TENANT_ID, {
      ...baseInput,
      name: 'Nightly sync',
      schedule: '@hourly',
      enabled: true,
    });

    expect(service1.getScheduler().getSchedule(pipeline.id)).toBeDefined();

    // Simulate process restart: new service, same durable repository.
    const service2 = new ETLService(repository, defaultConfig);
    expect(service2.getScheduler().getSchedule(pipeline.id)).toBeUndefined();
    expect(service2.getScheduler().getAllSchedules()).toHaveLength(0);

    // Pipeline row still durable.
    expect(await service2.getPipeline(TENANT_ID, pipeline.id)).toMatchObject({
      id: pipeline.id,
      schedule: '@hourly',
    });
  });

  it('hydrateSchedules rebuilds the scheduler Map after restart', async () => {
    const service1 = new ETLService(repository, defaultConfig);
    const a = await service1.createPipeline(TENANT_ID, {
      ...baseInput,
      name: 'A',
      schedule: '@hourly',
      enabled: true,
    });
    const b = await service1.createPipeline(TENANT_ID, {
      ...baseInput,
      name: 'B',
      schedule: '@daily',
      enabled: true,
    });
    await service1.createPipeline(TENANT_ID, {
      ...baseInput,
      name: 'Disabled',
      schedule: '@hourly',
      enabled: false,
    });

    const service2 = new ETLService(repository, defaultConfig);
    expect(service2.getScheduler().getAllSchedules()).toHaveLength(0);

    const n = await service2.hydrateSchedules(TENANT_ID);
    expect(n).toBe(2);
    expect(service2.getScheduler().getSchedule(a.id)?.cronExpression).toBe('@hourly');
    expect(service2.getScheduler().getSchedule(b.id)?.cronExpression).toBe('@daily');
    expect(service2.getScheduler().getAllSchedules()).toHaveLength(2);
  });

  it('listPipelines after restart auto-hydrates schedules', async () => {
    const service1 = new ETLService(repository, defaultConfig);
    const pipeline = await service1.createPipeline(TENANT_ID, {
      ...baseInput,
      name: 'Auto',
      schedule: '@weekly',
      enabled: true,
    });

    const service2 = new ETLService(repository, defaultConfig);
    expect(service2.getScheduler().getAllSchedules()).toHaveLength(0);

    await service2.listPipelines(TENANT_ID, {}, 1, 20);
    expect(service2.getScheduler().getSchedule(pipeline.id)?.cronExpression).toBe('@weekly');
  });
});
