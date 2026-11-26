/**
 * PRC-L098: pipeline events and the retries-exhausted alert are written to the
 * durable outbox (event contract `etl.pipeline.*`), not kept in process memory.
 */
import { describe, expect, it } from 'vitest';

import {
  ETL_PIPELINE_FAILURE_ALERT_TYPE,
  OutboxAdminNotifier,
  OutboxPipelineEventPublisher,
  type PipelineOutboxEntry,
} from './outbox-pipeline-events.js';
import { createPipelineEvent } from './pipeline-events.js';
import { TestableRetryExecutor } from './retry-executor.js';

const TENANT = '6f0b6c1e-3b7a-4c55-9d1e-2a4f8b9c0d11';
const PIPELINE = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const EXECUTION = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';

function recordingOutbox() {
  const entries: PipelineOutboxEntry[] = [];
  return {
    entries,
    async enqueue(entry: PipelineOutboxEntry) {
      entries.push(entry);
      return entry;
    },
  };
}

describe('OutboxPipelineEventPublisher (PRC-L098)', () => {
  it('writes each lifecycle event as a published etl.pipeline.* outbox row', async () => {
    const outbox = recordingOutbox();
    const nextRetryAt = new Date('2026-09-09T07:30:00.000Z');
    await new OutboxPipelineEventPublisher(outbox).publish(
      createPipelineEvent(
        'pipeline.execution.retrying',
        TENANT,
        PIPELINE,
        { pipelineName: 'Nightly', attempt: 1, maxRetries: 3, nextRetryAt, lastError: 'x' },
        EXECUTION,
      ),
    );
    expect(outbox.entries).toHaveLength(1);
    const [entry] = outbox.entries;
    expect(entry).toMatchObject({
      tenantId: TENANT,
      aggregateType: 'etl_pipeline',
      aggregateId: PIPELINE,
      eventType: 'etl.pipeline.execution.retrying',
      dispatchMode: 'publish',
      metadata: { correlationId: EXECUTION },
    });
    expect(entry!.payload).toMatchObject({
      type: 'pipeline.execution.retrying',
      tenantId: TENANT,
      pipelineId: PIPELINE,
      executionId: EXECUTION,
      payload: { nextRetryAt: '2026-09-09T07:30:00.000Z', attempt: 1 },
    });
    // JSON-safe: the payload survives a round trip unchanged.
    expect(JSON.parse(JSON.stringify(entry!.payload))).toEqual(entry!.payload);
  });
});

describe('OutboxAdminNotifier (PRC-L098)', () => {
  it('a retries-exhausted execution enqueues one failure alert', async () => {
    const outbox = recordingOutbox();
    const executor = new TestableRetryExecutor(new OutboxAdminNotifier(outbox));
    const result = await executor.executeWithRetry(
      EXECUTION,
      EXECUTION,
      TENANT,
      'Nightly',
      { maxRetries: 1, backoffMs: 10 },
      async () => {
        throw new Error('source unreachable');
      },
    );
    expect(result.exhausted).toBe(true);
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({
      tenantId: TENANT,
      eventType: ETL_PIPELINE_FAILURE_ALERT_TYPE,
      dispatchMode: 'publish',
      payload: {
        tenantId: TENANT,
        pipelineName: 'Nightly',
        executionId: EXECUTION,
        totalAttempts: 2,
        lastError: 'source unreachable',
      },
    });
  });

  it('a run that succeeds after a retry sends no alert', async () => {
    const outbox = recordingOutbox();
    const executor = new TestableRetryExecutor(new OutboxAdminNotifier(outbox));
    let calls = 0;
    await executor.executeWithRetry(
      EXECUTION,
      EXECUTION,
      TENANT,
      'Nightly',
      { maxRetries: 2, backoffMs: 10 },
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('transient');
        return 'ok';
      },
    );
    expect(outbox.entries).toEqual([]);
  });
});
