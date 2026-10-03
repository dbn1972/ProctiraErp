/**
 * PRC-M225 — one run row per execution across retries, single-flight per pipeline,
 * and a stable idempotency key so a retried load does not duplicate rows.
 */
import { describe, expect, it } from 'vitest';

import { defaultConnectorFactory, type ConnectorFactory } from './connectors/index.js';
import type {
  DataRow,
  DestinationConnector,
  LoadContext,
  LoadResult,
} from './connectors/types.js';
import { ETLService } from './etl-service.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import type { CreatePipelineInput } from './schemas.js';

const TENANT = 'tenant-m225';

/** Destination that honours idempotency keys and fails mid-load on the first attempt. */
class FlakyIdempotentDestination implements DestinationConnector {
  readonly stored = new Map<string, DataRow>();
  calls = 0;
  release: (() => void) | null = null;
  gate: Promise<void> | null = null;

  async load(rows: DataRow[], context: LoadContext = {}): Promise<LoadResult> {
    this.calls += 1;
    if (this.gate) await this.gate;
    for (const [i, row] of rows.entries()) {
      if (this.calls === 1 && i === 1) throw new Error('connection reset mid-load');
      this.stored.set(`${context.idempotencyKey}:${i}`, row);
    }
    return { loadedCount: rows.length, errorCount: 0, errors: [] };
  }

  async validate() {
    return { valid: true };
  }
}

function factory(dest: DestinationConnector): ConnectorFactory {
  return {
    createSource: (c) => defaultConnectorFactory.createSource(c),
    createDestination: () => dest,
  };
}

const input = (maxRetries: number): CreatePipelineInput => ({
  name: 'p',
  source: { type: 'csv', fileContent: 'a\n1\n2\n3\n', delimiter: ',', hasHeader: true },
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
  fieldMappings: [{ sourceField: 'a', destinationField: 'a' }],
  retryPolicy: { maxRetries, backoffMs: 100 },
});

function build(dest: DestinationConnector, repository = new InMemoryPipelineRepository()) {
  return {
    repository,
    service: new ETLService(repository, {
      defaultRetryPolicy: { maxRetries: 0, backoffMs: 100 },
      testMode: true,
      connectorFactory: factory(dest),
    }),
  };
}

describe('ETL run single-flight and idempotent retries (PRC-M225)', () => {
  it('a second concurrent execute returns 409', async () => {
    const dest = new FlakyIdempotentDestination();
    dest.calls = 1; // no mid-load failure
    dest.gate = new Promise((r) => (dest.release = r));
    const { service } = build(dest);
    const p = await service.createPipeline(TENANT, input(0));

    const first = service.executePipeline(TENANT, p.id);
    await new Promise((r) => setTimeout(r, 10));
    await expect(service.executePipeline(TENANT, p.id)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(service.executePipelineWithRetry(TENANT, p.id)).rejects.toMatchObject({
      statusCode: 409,
    });
    dest.release!();
    expect((await first).status).toBe('completed');
    // After completion a new run may start.
    await expect(service.executePipeline(TENANT, p.id)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('retry after a partial load reuses the run id: no duplicate rows, one run row', async () => {
    const dest = new FlakyIdempotentDestination();
    const { service, repository } = build(dest);
    const p = await service.createPipeline(TENANT, input(2));

    const run = await service.executePipelineWithRetry(TENANT, p.id);
    expect(run.status).toBe('completed');
    expect(dest.calls).toBe(2);
    // 3 source rows, first attempt stored row 0 before failing; retry re-sent all
    // three with the same key → exactly 3 stored rows.
    expect(dest.stored.size).toBe(3);
    const runs = await repository.listExecutions(p.id, TENANT, 1, 50);
    expect(runs.total).toBe(1);
    expect(runs.data[0]!.id).toBe(run.id);
  });

  it('exhausted retries settle the same run row as failed', async () => {
    const dest: DestinationConnector = {
      load: async () => {
        throw new Error('down');
      },
      validate: async () => ({ valid: true }),
    };
    const { service, repository } = build(dest);
    const p = await service.createPipeline(TENANT, input(1));
    const run = await service.executePipelineWithRetry(TENANT, p.id);
    expect(run.status).toBe('failed');
    const runs = await repository.listExecutions(p.id, TENANT, 1, 50);
    expect(runs.total).toBe(1);
    expect(runs.data[0]!.status).toBe('failed');
  });
});
