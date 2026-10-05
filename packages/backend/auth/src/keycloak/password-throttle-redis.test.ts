/**
 * PRC-H043 — real-Redis proof that the password-login failure budget is shared by replicas.
 *
 * Two independent PasswordLoginThrottle instances (two gateway replicas) with their own
 * connections to one Redis: failures on either count towards one lock, the lock is
 * visible to both, and success clears it. Runs when REDIS_URL is set (CI backend suites step);
 * skips otherwise.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordLoginThrottle, RedisPasswordThrottleState } from './password-throttle.js';
import { RespTestClient } from './resp-test-client.js';

const REDIS_URL = process.env['REDIS_URL'];
const describeRedis = REDIS_URL ? describe : describe.skip;

describeRedis('PRC-H043 Redis-backed password throttle (live Redis)', () => {
  let clientA: RespTestClient;
  let clientB: RespTestClient;
  // Unique prefix per run so parallel suites / reruns never share buckets.
  const prefix = `test:pwthrottle:${randomUUID()}:`;

  beforeAll(async () => {
    clientA = await RespTestClient.connect(REDIS_URL as string);
    clientB = await RespTestClient.connect(REDIS_URL as string);
  });

  afterAll(async () => {
    const keys = await clientA.keys(`${prefix}*`);
    if (keys.length > 0) await clientA.del(...keys);
    await clientA.quit();
    await clientB.quit();
  });

  const replica = (client: RespTestClient) =>
    new PasswordLoginThrottle({
      maxAccountFailures: 3,
      maxIpFailures: 100,
      windowSeconds: 60,
      lockSeconds: 30,
      state: new RedisPasswordThrottleState(client, prefix),
    });

  it('failures across replicas share one budget and the lock holds on both', async () => {
    const a = replica(clientA);
    const b = replica(clientB);
    const user = `victim-${randomUUID()}@example.org`;
    await a.recordFailure(user, '10.0.0.1');
    await b.recordFailure(user, '10.0.0.2');
    expect(await a.check(user, '10.0.0.3')).toEqual({ allowed: true });
    await a.recordFailure(user, '10.0.0.4');
    const onA = await a.check(user, '10.9.9.9');
    const onB = await b.check(user, '10.9.9.8');
    expect(onA.allowed).toBe(false);
    expect(onB.allowed).toBe(false);
    if (!onB.allowed) {
      expect(onB.retryAfterSeconds).toBeGreaterThan(0);
      expect(onB.retryAfterSeconds).toBeLessThanOrEqual(30);
    }
    // Keys are hashed and expire: no plaintext username, every key has a TTL.
    const keys = await clientA.keys(`${prefix}*`);
    expect(keys.join(' ')).not.toContain('victim');
    for (const key of keys) expect(await clientA.pttl(key)).toBeGreaterThan(0);
  });

  it('a successful login on one replica clears the account bucket for all', async () => {
    const a = replica(clientA);
    const b = replica(clientB);
    const user = `teacher-${randomUUID()}@example.org`;
    for (let i = 0; i < 3; i += 1) await a.recordFailure(user, undefined);
    expect((await b.check(user, undefined)).allowed).toBe(false);
    await b.recordSuccess(user);
    expect((await a.check(user, undefined)).allowed).toBe(true);
  });
});
