/**
 * PRC-M361: live SQS round trip (LocalStack/ElasticMQ). Runs only when
 * SQS_LIVE_ENDPOINT is set, e.g. SQS_LIVE_ENDPOINT=http://127.0.0.1:4566.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SQSAdapter } from '../adapters/sqs-adapter';
import { buildTenantName } from '../types';
import type { QueueMessage } from '../types';

const endpoint = process.env['SQS_LIVE_ENDPOINT'];

describe.skipIf(!endpoint)('SQSAdapter live round trip (PRC-M361)', () => {
  for (const fifo of [false, true]) {
    it(`${fifo ? 'FIFO' : 'standard'}: dispatch then consume delivers exactly one message`, async () => {
      const adapter = new SQSAdapter({
        region: 'us-east-1',
        endpoint,
        accessKeyId: 'test',
        secretAccessKey: 'test',
        queueUrlPrefix: '',
        autoCreateQueues: true,
        waitTimeSeconds: 1,
        fifo,
      });
      await adapter.connect();
      const tenantId = randomUUID();
      const type = `m361${fifo ? 'f' : 's'}${Date.now()}`;
      const message: QueueMessage = {
        id: randomUUID(),
        tenantId,
        type,
        payload: { ok: true },
        timestamp: new Date().toISOString(),
      };
      await adapter.dispatch(message);
      const received: QueueMessage[] = [];
      await adapter.consume({ topic: buildTenantName(tenantId, type) }, async (m) => {
        received.push(m);
      });
      const deadline = Date.now() + 15_000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      // allow a further poll to prove no redelivery
      await new Promise((r) => setTimeout(r, 2500));
      await adapter.disconnect();
      expect(received).toHaveLength(1);
      expect(received[0]!.id).toBe(message.id);
    }, 30_000);
  }
});
