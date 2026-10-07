/**
 * PRC-M364 chaos test: restart RabbitMQ, the worker resumes consuming.
 * Runs only when RABBITMQ_LIVE_URL and RABBITMQ_RESTART_CMD are set, e.g.
 *   RABBITMQ_LIVE_URL=amqp://guest:guest@127.0.0.1:5672
 *   RABBITMQ_RESTART_CMD="docker restart my-rabbit"
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { RabbitMQAdapter } from '../adapters/rabbitmq-adapter';
import { buildTenantName } from '../types';
import type { QueueMessage } from '../types';

const url = process.env['RABBITMQ_LIVE_URL'];
const restartCmd = process.env['RABBITMQ_RESTART_CMD'];

async function until(pred: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if (await pred()) return true;
    } catch {
      // broker still coming back
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

describe.skipIf(!url || !restartCmd)('RabbitMQAdapter reconnect (PRC-M364)', () => {
  it('resumes consuming after a broker restart', async () => {
    const exchange = `m364.${Date.now()}`;
    const warns: string[] = [];
    const logger = {
      warn: (_o: Record<string, unknown>, m?: string) => warns.push(m ?? ''),
      error: () => undefined,
    };
    const opts = { url: url!, exchange, deadLetterExchange: `${exchange}.dlx` };
    const runtime = { logger, reconnect: { initialDelayMs: 250, maxDelayMs: 2000 } };
    const worker = new RabbitMQAdapter(opts, runtime);
    const producer = new RabbitMQAdapter(opts, runtime);
    await worker.connect();
    await producer.connect();
    const tenantId = randomUUID();
    const type = 'report.generate';
    const got: string[] = [];
    await worker.consume({ topic: buildTenantName(tenantId, type) }, async (m: QueueMessage) => {
      got.push(m.id);
    });
    const send = (id: string) =>
      producer.dispatch({ id, tenantId, type, payload: {}, timestamp: new Date().toISOString() });
    await send('before');
    expect(await until(() => got.includes('before'), 5000)).toBe(true);

    execSync(restartCmd!, { stdio: 'ignore' });

    expect(await until(() => worker.reconnectCount > 0 && producer.isConnected(), 60_000)).toBe(
      true,
    );
    // durable queue survives the restart; the resumed consumer receives new work
    expect(
      await until(async () => {
        if (!got.includes('after')) await send('after');
        return got.includes('after');
      }, 30_000),
    ).toBe(true);
    expect(warns).toContain('rabbitmq reconnected; consumers resumed');
    await worker.disconnect();
    await producer.disconnect();
  }, 120_000);
});
