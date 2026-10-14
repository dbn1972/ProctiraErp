/**
 * Unit tests for the exam-document worker handler (PRC-L103, PRC-L468).
 *
 * These exercise the message guard and processing branches directly by
 * capturing the handler the worker registers with a fake queue adapter, so no
 * broker/DB is required. They cover the failure modes the single restart-safe
 * proof did not: wrong message type, malformed payload, processor throw
 * (retryable rethrow), and graceful stop.
 */
import type {
  MessageHandler,
  QueueAdapter,
  QueueMessage,
  SubscribeOptions,
} from '@proctira/queue-abstraction';
import { EXAM_DOCUMENT_JOB_TYPE } from '@proctira/queue-abstraction';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createExamDocumentWorker, type ExamDocumentJobProcessor } from '../worker.js';

/** Minimal fake adapter that captures the consume handler for direct invocation. */
class FakeQueueAdapter implements QueueAdapter {
  handler: MessageHandler | null = null;
  private connected = false;
  disconnectCalls = 0;

  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }
  async publish(): Promise<void> {}
  async subscribe(): Promise<void> {}
  async dispatch(): Promise<void> {}
  async consume(_options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    this.handler = handler;
  }
  async healthCheck() {
    return { healthy: this.connected, status: this.connected ? 'up' : 'down' } as never;
  }
  isConnected(): boolean {
    return this.connected;
  }
}

function makeMessage(overrides: Partial<QueueMessage>): QueueMessage {
  return {
    id: 'msg-1',
    tenantId: 'tenant-1',
    type: EXAM_DOCUMENT_JOB_TYPE,
    payload: { jobId: 'job-1' },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

const errorLog: Array<{ obj: Record<string, unknown>; msg: string }> = [];
const logger = {
  info: () => {},
  error: (obj: Record<string, unknown>, msg: string) => errorLog.push({ obj, msg }),
};

describe('exam-document worker handler', () => {
  let adapter: FakeQueueAdapter;
  let processJob: ReturnType<typeof vi.fn>;
  let processor: ExamDocumentJobProcessor;

  beforeEach(async () => {
    errorLog.length = 0;
    adapter = new FakeQueueAdapter();
    processJob = vi.fn().mockResolvedValue({ status: 'completed' });
    processor = { processJob: processJob as unknown as ExamDocumentJobProcessor['processJob'] };
    const worker = createExamDocumentWorker({ queue: adapter, processor, logger });
    await worker.start();
    expect(adapter.handler).toBeTypeOf('function');
  });

  it('processes a well-formed exam-document message exactly once (PRC-M235)', async () => {
    await adapter.handler!(makeMessage({}));
    expect(processJob).toHaveBeenCalledTimes(1);
    expect(processJob).toHaveBeenCalledWith('tenant-1', 'job-1', { rethrowRetryable: true });
  });

  it('rejects (throws) a wrong-typed message even when it carries a jobId payload (PRC-L103)', async () => {
    await expect(
      adapter.handler!(makeMessage({ type: 'some.other.event', payload: { jobId: 'job-1' } })),
    ).rejects.toThrow(/Unexpected exam document message/);
    expect(processJob).not.toHaveBeenCalled();
    expect(errorLog.at(-1)?.msg).toContain('rejected unexpected message');
  });

  it('rejects (throws) a correctly-typed message with a malformed payload (PRC-L103)', async () => {
    await expect(adapter.handler!(makeMessage({ payload: { notJobId: true } }))).rejects.toThrow(
      /Unexpected exam document message/,
    );
    expect(processJob).not.toHaveBeenCalled();
  });

  it('rejects (throws) a correctly-typed message with an empty jobId (PRC-L103)', async () => {
    await expect(adapter.handler!(makeMessage({ payload: { jobId: '' } }))).rejects.toThrow(
      /Unexpected exam document message/,
    );
    expect(processJob).not.toHaveBeenCalled();
  });

  it('propagates a transient processor error so the broker redelivers (PRC-M619)', async () => {
    processJob.mockRejectedValueOnce(new Error('transient db blip'));
    await expect(adapter.handler!(makeMessage({}))).rejects.toThrow(/transient db blip/);
    expect(processJob).toHaveBeenCalledWith('tenant-1', 'job-1', { rethrowRetryable: true });
  });

  it('stop() disconnects the queue and marks the worker not running (PRC-M508)', async () => {
    const worker = createExamDocumentWorker({ queue: adapter, processor, logger });
    await worker.start();
    expect(worker.running).toBe(true);
    await worker.stop();
    expect(worker.running).toBe(false);
    expect(adapter.disconnectCalls).toBeGreaterThanOrEqual(1);
  });
});
