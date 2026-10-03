/**
 * PRC-M226 — bounded memory/time: SQL-side paging, capped stored errors, hung
 * remote bodies time out, scheduler errors are reported with bounded concurrency,
 * and the default event publisher is a bounded buffer.
 */
import { describe, expect, it } from 'vitest';

import { safeFetch } from './connectors/safe-fetch.js';
import { PgPipelineRepository } from './pg-pipeline-repository.js';
import { createPipelineEvent, InMemoryEventPublisher } from './pipeline-events.js';
import { PipelineScheduler } from './pipeline-scheduler.js';
import { AesGcmConnectorSecretCipher } from './connector-secret-crypto.js';
import { randomBytes } from 'node:crypto';

const TENANT = '5f0c3a2b-1d4e-4a6b-8c7d-9e0f1a2b3c4d';
const PIPE = '7b2e4c5d-3f6a-4c8d-ae9f-1a2b3c4d5e6f';

describe('bounded ETL resources (PRC-M226)', () => {
  it('listExecutions over 10k runs pages in SQL and returns at most pageSize rows', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const runs = Array.from({ length: 10_000 }, (_, i) => ({
      document: {
        id: `r-${i}`,
        tenantId: TENANT,
        pipelineId: PIPE,
        status: 'completed',
        startedAt: new Date(2026, 0, 1, 0, i).toISOString(),
        completedAt: null,
      },
    }));
    const client = {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        if (sql.includes('COUNT(*)')) return { rows: [{ total: runs.length }] };
        if (sql.includes('FROM etl_pipeline_runs')) {
          const [, , limit, offset] = params as [string, string, number, number];
          return { rows: runs.slice(offset, offset + limit) };
        }
        return { rows: [] };
      },
      release() {},
    };
    const repo = new PgPipelineRepository(
      { connect: async () => client } as never,
      new AesGcmConnectorSecretCipher(randomBytes(32)),
    );
    const page = await repo.listExecutions(PIPE, TENANT, 3, 20);
    expect(page.total).toBe(10_000);
    expect(page.data).toHaveLength(20);
    const select = queries.find((q) => q.sql.includes('LIMIT'))!;
    expect(select.params.slice(2)).toEqual([20, 40]);
    // No query returns the whole table.
    expect(queries.every((q) => q.sql.includes('COUNT(*)') || q.sql.includes('LIMIT') || !q.sql.includes('etl_pipeline_runs'))).toBe(true);
  });

  it('pipeline search is parameterised and escapes LIKE wildcards', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        if (sql.includes('COUNT(*)')) return { rows: [{ total: 0 }] };
        return { rows: [] };
      },
      release() {},
    };
    const repo = new PgPipelineRepository(
      { connect: async () => client } as never,
      new AesGcmConnectorSecretCipher(randomBytes(32)),
    );
    await repo.list(TENANT, { search: "50%_off'; DROP", enabled: true }, 1, 10);
    const select = queries.find((q) => q.sql.includes('FROM etl_pipelines') && q.sql.includes('LIMIT'))!;
    expect(select.sql).not.toContain('DROP');
    expect(select.params).toContain('%50\\%\\_off\'; DROP%');
    expect(select.params).toContain(true);
  });

  it('a server that sends headers then stalls the body times out', async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"rows":['));
        // never closes
      },
    });
    const started = Date.now();
    await expect(
      safeFetch('https://api.example.com/data', {
        timeoutMs: 50,
        deps: {
          resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
          fetchImpl: (async () => new Response(stalled, { status: 200 })) as typeof fetch,
        },
      }),
    ).rejects.toThrow(/timed out|abort/i);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('scheduler reports failing runs and keeps running the others concurrently', async () => {
    const errors: string[] = [];
    const scheduler = new PipelineScheduler({
      maxConcurrentRuns: 2,
      onError: (e, entry) => errors.push(`${entry?.pipelineId}:${(e as Error).message}`),
    });
    for (const id of ['a', 'b', 'c']) {
      scheduler.registerSchedule(id, 't', '* * * * *');
      scheduler.getSchedule(id)!.nextRunAt = new Date(Date.now() - 1000);
    }
    let active = 0;
    let peak = 0;
    const ran: string[] = [];
    scheduler.onDue(async (entry) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      if (entry.pipelineId === 'a') throw new Error('boom');
      ran.push(entry.pipelineId);
    });
    await scheduler.tick();
    expect(errors).toEqual(['a:boom']);
    expect(ran.sort()).toEqual(['b', 'c']);
    expect(peak).toBe(2);
  });

  it('the default in-memory event publisher is bounded', async () => {
    const publisher = new InMemoryEventPublisher(5);
    for (let i = 0; i < 20; i++) {
      await publisher.publish(createPipelineEvent('pipeline.execution.started', 't', `p${i}`, {}));
    }
    expect(publisher.events).toHaveLength(5);
    expect(publisher.events[0]!.pipelineId).toBe('p15');
  });
});
