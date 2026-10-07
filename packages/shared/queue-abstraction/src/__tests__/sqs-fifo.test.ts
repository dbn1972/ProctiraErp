/**
 * PRC-M361: SQS standard vs FIFO handling (mocked client).
 */
import { describe, it, expect, vi } from 'vitest';
import { SQSAdapter } from '../adapters/sqs-adapter';
import type { QueueMessage } from '../types';

const T1 = '11111111-1111-4111-8111-111111111111';

function msg(): QueueMessage {
  return {
    id: 'm-1',
    tenantId: T1,
    type: 'exam.document',
    payload: { a: 1 },
    timestamp: new Date().toISOString(),
  };
}

async function adapterWithSpy(cfg: { fifo?: boolean } = {}) {
  const adapter = new SQSAdapter({
    region: 'us-east-1',
    queueUrlPrefix: '',
    autoCreateQueues: true,
    ...cfg,
  });
  await adapter.connect();
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = (adapter as unknown as { client: { send: (c: unknown) => Promise<unknown> } })
    .client;
  client.send = vi.fn(async (cmd: unknown) => {
    const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
    calls.push({ name: c.constructor.name, input: c.input });
    if (c.constructor.name === 'GetQueueUrlCommand') {
      const err = new Error('nope') as Error & { name: string };
      err.name = 'QueueDoesNotExist';
      throw err;
    }
    if (c.constructor.name === 'CreateQueueCommand') {
      return { QueueUrl: `https://sqs/${String(c.input['QueueName'])}` };
    }
    if (c.constructor.name === 'GetQueueAttributesCommand') {
      return { Attributes: { QueueArn: 'arn:aws:sqs:us-east-1:000000000000:dlq' } };
    }
    return {};
  });
  return { adapter, calls };
}

function mainCreate(calls: Array<{ name: string; input: Record<string, unknown> }>) {
  return calls.find(
    (c) => c.name === 'CreateQueueCommand' && !String(c.input['QueueName']).includes('-dlq'),
  )!;
}

describe('SQSAdapter queue type handling (PRC-M361)', () => {
  it('standard queues: no MessageGroupId / MessageDeduplicationId, no FifoQueue attribute', async () => {
    const { adapter, calls } = await adapterWithSpy();
    await adapter.dispatch(msg());
    const create = mainCreate(calls);
    expect(String(create.input['QueueName'])).not.toMatch(/\.fifo$/);
    expect((create.input['Attributes'] as Record<string, string>)['FifoQueue']).toBeUndefined();
    const send = calls.find((c) => c.name === 'SendMessageCommand')!;
    expect(send.input['MessageGroupId']).toBeUndefined();
    expect(send.input['MessageDeduplicationId']).toBeUndefined();
    await adapter.disconnect();
  });

  it('FIFO queues: .fifo suffix preserved, FifoQueue set, group/dedup ids sent', async () => {
    const { adapter, calls } = await adapterWithSpy({ fifo: true });
    await adapter.dispatch(msg());
    const create = mainCreate(calls);
    expect(String(create.input['QueueName'])).toMatch(/^[A-Za-z0-9_-]+\.fifo$/);
    expect((create.input['Attributes'] as Record<string, string>)['FifoQueue']).toBe('true');
    const send = calls.find((c) => c.name === 'SendMessageCommand')!;
    expect(send.input['MessageGroupId']).toBe(T1);
    expect(send.input['MessageDeduplicationId']).toBe('m-1');
    await adapter.disconnect();
  });

  it('explicit .fifo topic is detected before dot sanitising', async () => {
    const adapter = new SQSAdapter({ region: 'us-east-1', queueUrlPrefix: '' });
    expect(adapter.toSqsQueueName(`tenant.${T1}.jobs.fifo`)).toBe(`tenant-${T1}-jobs.fifo`);
    expect(adapter.toSqsQueueName(`tenant.${T1}.jobs`)).toBe(`tenant-${T1}-jobs`);
    expect(() => adapter.toSqsQueueName('x'.repeat(81))).toThrow(/80 characters/);
  });
});

describe('SQS DLQ naming length (review #15, PR #555)', () => {
  it('derives DLQ names within the 80-char limit, keeping .fifo', () => {
    expect(SQSAdapter.deadLetterQueueName('a'.repeat(76))).toBe(`${'a'.repeat(76)}-dlq`);
    expect(SQSAdapter.deadLetterQueueName(`${'a'.repeat(71)}.fifo`)).toBe(
      `${'a'.repeat(71)}-dlq.fifo`,
    );
  });

  it('rejects (never truncates) DLQ names over 80 chars, incl. .fifo', () => {
    expect(() => SQSAdapter.deadLetterQueueName('a'.repeat(77))).toThrow(/exceeds 80/);
    expect(() => SQSAdapter.deadLetterQueueName(`${'a'.repeat(72)}.fifo`)).toThrow(/exceeds 80/);
  });

  it('a 77-80 char queue name fails before ANY CreateQueue (no queue left without redrive)', async () => {
    const { adapter, calls } = await adapterWithSpy();
    // tenant.<uuid>.<topic> = 44 + 34 = 78 chars: valid main name, DLQ would be 82.
    const topic = 'q'.repeat(34);
    expect(adapter.toSqsQueueName(`tenant.${T1}.${topic}`)).toHaveLength(78);
    await expect(adapter.dispatch(msg(), { topic })).rejects.toThrow(/dead-letter queue name/);
    expect(calls.some((c) => c.name === 'CreateQueueCommand')).toBe(false);
  });
});
