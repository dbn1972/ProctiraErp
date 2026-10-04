/**
 * PRC-L353 — query values, credentials and body secrets never reach the log sink.
 */
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loggingPlugin, sanitizeUrlForLog } from './fastify-plugin.js';
import { createLogger } from './logger.js';

function sink(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, text: () => chunks.join('') };
}

describe('logging redaction (PRC-L353)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sanitizeUrlForLog keeps keys but drops every query value', () => {
    expect(sanitizeUrlForLog('/a/b?token=abc&x=1')).toBe('/a/b?token=[Redacted]&x=[Redacted]');
    expect(sanitizeUrlForLog('/a/b')).toBe('/a/b');
  });

  it('request with ?token=abc logs no "abc"', async () => {
    const s = sink();
    const app = Fastify({ logger: false });
    await app.register(loggingPlugin, { level: 'debug', destination: s.stream });
    app.get('/verify', async () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/verify?token=abcSECRET&otp=998877' });
    await app.close();
    expect(s.text()).toContain('/verify');
    expect(s.text()).not.toContain('abcSECRET');
    expect(s.text()).not.toContain('998877');
  });

  it('logBody (preHandler) redacts password', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const s = sink();
    const app = Fastify({ logger: false });
    await app.register(loggingPlugin, { level: 'debug', logBody: true, destination: s.stream });
    app.post('/login', async () => ({ ok: true }));
    await app.inject({
      method: 'POST',
      url: '/login',
      payload: { username: 'u1', password: 'hunter2-secret' },
    });
    await app.close();
    expect(s.text()).toContain('"username":"u1"');
    expect(s.text()).toContain('[Redacted]');
    expect(s.text()).not.toContain('hunter2-secret');
  });

  it('refuses logBody in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const s = sink();
    const app = Fastify({ logger: false });
    await app.register(loggingPlugin, { level: 'debug', logBody: true, destination: s.stream });
    app.post('/login', async () => ({ ok: true }));
    await app.inject({ method: 'POST', url: '/login', payload: { username: 'prod-user-x' } });
    await app.close();
    expect(s.text()).not.toContain('prod-user-x');
  });

  it('ignorePaths matches the pathname even with a query string', async () => {
    const s = sink();
    const app = Fastify({ logger: false });
    await app.register(loggingPlugin, { ignorePaths: ['/health'], destination: s.stream });
    app.get('/health', async () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/health?probe=1' });
    await app.close();
    expect(s.text()).not.toContain('/health');
  });

  it('createLogger redacts authorization headers and nested tokens', () => {
    const s = sink();
    const log = createLogger({ destination: s.stream });
    log.info({ headers: { authorization: 'Bearer zzz-top' }, user: { token: 'tok-123' } }, 'x');
    expect(s.text()).not.toContain('zzz-top');
    expect(s.text()).not.toContain('tok-123');
  });
});
