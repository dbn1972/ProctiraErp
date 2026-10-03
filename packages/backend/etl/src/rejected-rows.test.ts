/**
 * PRC-M227 — rows whose transformation fails are not loaded, and the run status
 * shows the partial failure.
 */
import { describe, expect, it } from 'vitest';

import { ETLService } from './etl-service.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import type { CreatePipelineInput } from './schemas.js';
import {
  MemoryDestination,
  memoryConnectorFactory,
} from './test-support/memory-connector-factory.js';

const TENANT = 'tenant-m227';

describe('rejected rows (PRC-M227)', () => {
  it('a row with a bad number never reaches the destination; status is completed_with_errors', async () => {
    const sink = new MemoryDestination();
    const service = new ETLService(new InMemoryPipelineRepository(), {
      defaultRetryPolicy: { maxRetries: 0, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1 },
      testMode: true,
      connectorFactory: memoryConnectorFactory(sink),
    });
    const input: CreatePipelineInput = {
      name: 'nums',
      source: {
        type: 'csv',
        fileContent: 'name,amount\nok,12\nbad,abc\nok2,7\n',
        delimiter: ',',
        hasHeader: true,
      },
      destination: {
        type: 'postgresql',
        host: 'h',
        port: 5432,
        database: 'd',
        username: 'u',
        password: 'p',
        table: 't',
        writeMode: 'insert',
      },
      fieldMappings: [
        { sourceField: 'name', destinationField: 'name' },
        {
          sourceField: 'amount',
          destinationField: 'amount',
          transformation: 'type_cast',
          transformConfig: { targetType: 'number' },
        },
      ],
    };
    const pipeline = await service.createPipeline(TENANT, input);
    const run = await service.executePipeline(TENANT, pipeline.id);

    expect(sink.rows).toEqual([
      { name: 'ok', amount: 12 },
      { name: 'ok2', amount: 7 },
    ]);
    expect(sink.rows.some((r) => r['amount'] === 'abc')).toBe(false);
    expect(run.status).toBe('completed_with_errors');
    expect(run.loadedCount).toBe(2);
    expect(run.errors).toEqual([expect.objectContaining({ row: 1, field: 'amount' })]);
  });
});
