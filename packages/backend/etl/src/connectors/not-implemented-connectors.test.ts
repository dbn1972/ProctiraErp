/**
 * PRC-M222 — postgresql source/destination and excel source fail closed instead of
 * reporting success without moving any data.
 */
import { describe, expect, it } from 'vitest';

import { ETLService } from '../etl-service.js';
import { InMemoryPipelineRepository } from '../in-memory-repository.js';
import type { CreatePipelineInput, Pipeline } from '../schemas.js';
import { createDestinationConnector, createSourceConnector } from './connector-factory.js';
import { ExcelSourceConnector } from './excel-source.js';
import { PostgresDestinationConnector } from './postgresql-destination.js';
import { PostgresSourceConnector } from './postgresql-source.js';

const pg = {
  host: 'db.example.com',
  port: 5432,
  database: 'warehouse',
  username: 'etl',
  password: 'secret',
};
const csvSource = { type: 'csv' as const, fileContent: 'a\n1\n', delimiter: ',', hasHeader: true };
const restDest = {
  type: 'rest_api' as const,
  url: 'https://api.example.com/ingest',
  method: 'POST' as const,
};

describe('unimplemented connectors (PRC-M222)', () => {
  it('factory refuses postgresql/excel with a 501 AppError', () => {
    for (const make of [
      () => createSourceConnector({ type: 'postgresql', ...pg, query: 'SELECT 1' }),
      () => createSourceConnector({ type: 'excel', fileContent: 'eA==' }),
      () =>
        createDestinationConnector({ type: 'postgresql', ...pg, table: 't', writeMode: 'insert' }),
    ]) {
      expect(make).toThrow(expect.objectContaining({ statusCode: 501 }));
    }
  });

  it('direct construction validates as invalid and never reports a fake success', async () => {
    const src = new PostgresSourceConnector({ type: 'postgresql', ...pg, query: 'SELECT 1' });
    expect((await src.validate()).valid).toBe(false);
    await expect(src.extract()).rejects.toMatchObject({ statusCode: 501 });

    const dest = new PostgresDestinationConnector({
      type: 'postgresql',
      ...pg,
      table: 't',
      writeMode: 'insert',
    });
    expect((await dest.validate()).valid).toBe(false);
    await expect(dest.load([{ a: 1 }])).rejects.toMatchObject({ statusCode: 501 });

    const xls = new ExcelSourceConnector({ type: 'excel', fileContent: 'eA==' });
    expect((await xls.validate()).valid).toBe(false);
    await expect(xls.extract()).rejects.toMatchObject({ statusCode: 501 });
  });

  it('creating a pipeline with source.type=postgresql is a 501 and nothing is stored', async () => {
    const repository = new InMemoryPipelineRepository();
    const service = new ETLService(repository, {
      defaultRetryPolicy: { maxRetries: 0, backoffMs: 100 },
      testMode: true,
    });
    const input = {
      name: 'pg',
      source: { type: 'postgresql', ...pg, query: 'SELECT 1' },
      destination: restDest,
      fieldMappings: [{ sourceField: 'a', destinationField: 'a' }],
    } as unknown as CreatePipelineInput;
    await expect(service.createPipeline('t1', input)).rejects.toMatchObject({ statusCode: 501 });
    expect((await repository.list('t1', {}, 1, 10)).total).toBe(0);
  });

  it('a stored (pre-existing) postgresql pipeline run is marked failed, not completed', async () => {
    const repository = new InMemoryPipelineRepository();
    const service = new ETLService(repository, {
      defaultRetryPolicy: { maxRetries: 0, backoffMs: 100 },
      testMode: true,
    });
    const now = new Date();
    const legacy: Pipeline = {
      id: '0b8f7b2e-3c1d-4a5e-9f6a-7b8c9d0e1f2a',
      tenantId: 't1',
      name: 'legacy',
      description: null,
      source: csvSource,
      destination: { type: 'postgresql', ...pg, table: 't', writeMode: 'insert' },
      fieldMappings: [{ sourceField: 'a', destinationField: 'a' }],
      schedule: null,
      retryPolicy: { maxRetries: 0, backoffMs: 100 },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    } as Pipeline;
    await repository.create(legacy);
    const run = await service.executePipelineWithRetry('t1', legacy.id);
    expect(run.status).toBe('failed');
    expect(run.loadedCount).toBe(0);
  });
});
