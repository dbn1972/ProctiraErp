/**
 * PRC-L355 — tenantId routing-segment validation and receive-side
 * body-vs-route tenant check (Kafka, SQS adapters).
 */
import * as fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kafkaState = vi.hoisted(() => ({
  eachMessage: undefined as undefined | ((p: unknown) => Promise<void>),
}));
vi.mock('kafkajs', () => {
  class Kafka {
    producer() {
      return { connect: vi.fn(), disconnect: vi.fn(), send: vi.fn() };
    }
    consumer() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        subscribe: vi.fn(),
        run: vi.fn(async (o: { eachMessage: (p: unknown) => Promise<void> }) => {
          kafkaState.eachMessage = o.eachMessage;
        }),
      };
    }
  }
  return { Kafka };
});

import { KafkaAdapter } from '../adapters/kafka-adapter';
import { SQSAdapter } from '../adapters/sqs-adapter';
import { messageTenantMatchesRoute, TenantScopeError } from '../tenant-scope';
import { buildTenantName } from '../types';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

function msg(tenantId: string) {
  return { id: 'm1', type: 'x', tenantId, payload: {}, timestamp: new Date().toISOString() };
}

describe('PRC-L355 buildTenantName tenant segment', () => {
  it("Property: rejects tenantIds containing '.', '*', '#'", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 10 }),
        fc.constantFrom('.', '*', '#'),
        fc.string({ minLength: 0, maxLength: 10 }),
        (a, bad, b) => {
          expect(() => buildTenantName(`x${a}${bad}${b}x`, 'events')).toThrow(TenantScopeError);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('accepts UUID tenant ids', () => {
    expect(buildTenantName(T1, 'events')).toBe(`tenant.${T1}.events`);
  });
});

describe('PRC-L355 messageTenantMatchesRoute', () => {
  it('matches only the concrete route tenant', () => {
    expect(messageTenantMatchesRoute(`tenant.${T1}.x`, msg(T1))).toBe(true);
    expect(messageTenantMatchesRoute(`tenant.${T1}.x`, msg(T2))).toBe(false);
    expect(messageTenantMatchesRoute('tenant.*.x', msg(T1))).toBe(false);
    expect(messageTenantMatchesRoute('events', msg(T1))).toBe(false);
  });
});

describe('PRC-L355 adapters drop tenant-mismatched messages', () => {
  beforeEach(() => {
    kafkaState.eachMessage = undefined;
  });

  it('Kafka: message with tenantId != topic tenant is not passed to the handler', async () => {
    const adapter = new KafkaAdapter({ brokers: ['b:9092'], clientId: 'c' });
    await adapter.connect();
    const handler = vi.fn();
    await adapter.subscribe({ topic: `tenant.${T1}.events` }, handler);
    const deliver = (tenantId: string) =>
      kafkaState.eachMessage!({
        topic: `tenant.${T1}.events`,
        partition: 0,
        message: { value: Buffer.from(JSON.stringify(msg(tenantId))) },
      });
    await deliver(T2);
    expect(handler).not.toHaveBeenCalled();
    await deliver(T1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('SQS: mismatched message is neither handled nor deleted', async () => {
    const adapter = new SQSAdapter({ region: 'us-east-1', waitTimeSeconds: 0 });
    await adapter.connect();
    const sent: string[] = [];
    let received = false;
    const client = (adapter as unknown as { client: { send: (c: unknown) => Promise<unknown> } })
      .client;
    client.send = vi.fn(async (cmd: unknown) => {
      const name = (cmd as { constructor: { name: string } }).constructor.name;
      sent.push(name);
      if (name === 'GetQueueUrlCommand') return { QueueUrl: 'https://sqs/q' };
      if (name === 'ReceiveMessageCommand') {
        if (received) return { Messages: [] };
        received = true;
        return {
          Messages: [
            { Body: JSON.stringify(msg(T2)), ReceiptHandle: 'r1' },
            { Body: JSON.stringify(msg(T1)), ReceiptHandle: 'r2' },
          ],
        };
      }
      return {};
    });
    const handler = vi.fn();
    await adapter.subscribe({ topic: `tenant.${T1}.events` }, handler);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(sent.filter((n) => n === 'DeleteMessageCommand')).toHaveLength(1),
    );
    expect((handler.mock.calls[0]![0] as { tenantId: string }).tenantId).toBe(T1);
    await adapter.disconnect();
  });
});
