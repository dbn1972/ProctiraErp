import { describe, expect, it } from 'vitest';
import { readPrivacyWorkerConfig } from './config.js';

describe('privacy worker config (PRC-H078)', () => {
  const base = { RABBITMQ_URL: 'amqp://broker:5672', DATABASE_URL: 'postgresql://app@db/x' };

  it('fails closed without a broker or a database', () => {
    expect(() => readPrivacyWorkerConfig({ DATABASE_URL: base.DATABASE_URL })).toThrow(/QUEUE/);
    expect(() => readPrivacyWorkerConfig({ RABBITMQ_URL: base.RABBITMQ_URL })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('defaults the health port to 8095 and validates overrides', () => {
    expect(readPrivacyWorkerConfig(base).healthPort).toBe(8095);
    expect(readPrivacyWorkerConfig({ ...base, PRIVACY_WORKER_HEALTH_PORT: '9000' }).healthPort).toBe(
      9000,
    );
    expect(() => readPrivacyWorkerConfig({ ...base, PRIVACY_WORKER_HEALTH_PORT: 'x' })).toThrow();
  });
});
