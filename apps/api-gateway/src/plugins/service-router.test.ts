/**
 * Integration tests for the service-router proxy.
 *
 * These spin up a *real* upstream HTTP server and assert that the gateway
 * forwards the method, path, query, headers, and body, and mirrors the
 * upstream status/body back to the caller — plus the failure paths
 * (upstream down → 502, slow upstream → 504).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import serviceRouter from './service-router.js';

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let upstream: Server;
let upstreamUrl: string;
let captured: CapturedRequest[] = [];
let upstreamDelayMs = 0;

beforeAll(async () => {
  upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      captured.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const respond = () => {
        if (req.url?.startsWith('/students/echo')) {
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, received: Buffer.concat(chunks).toString('utf8') }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json', 'x-upstream': 'yes' });
        res.end(JSON.stringify({ ok: true, path: req.url }));
      };
      if (upstreamDelayMs > 0) setTimeout(respond, upstreamDelayMs);
      else respond();
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = (upstream.address() as AddressInfo).port;
  upstreamUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

async function buildGateway(target: string, timeoutMs?: number): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(serviceRouter, {
    services: {
      students: { prefix: '/students', target, healthCheck: '/health', ...(timeoutMs ? { timeoutMs } : {}) },
    },
    versionPrefix: '/api/v1',
  });
  await app.ready();
  return app;
}

describe('service-router proxy', () => {
  beforeAll(() => {
    captured = [];
    upstreamDelayMs = 0;
  });

  it('forwards GET requests (path + query) and mirrors the upstream response', async () => {
    const app = await buildGateway(upstreamUrl);
    const res = await app.inject({ method: 'GET', url: '/api/v1/students/123?expand=guardians' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(res.headers['x-upstream']).toBe('yes');

    const last = captured.at(-1)!;
    expect(last.method).toBe('GET');
    expect(last.url).toBe('/students/123?expand=guardians');
    await app.close();
  });

  it('forwards POST body and preserves the upstream status code (201)', async () => {
    const app = await buildGateway(upstreamUrl);
    const payload = { firstName: 'Aarav', lastName: 'Sharma' };
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students/echo',
      payload,
      headers: { 'content-type': 'application/json', authorization: 'Bearer t', 'x-tenant-id': 'tenant-1' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);

    const last = captured.at(-1)!;
    expect(last.method).toBe('POST');
    expect(last.url).toBe('/students/echo');
    expect(JSON.parse(last.body)).toEqual(payload);
    // Auth + tenant headers are propagated downstream.
    expect(last.headers['authorization']).toBe('Bearer t');
    expect(last.headers['x-tenant-id']).toBe('tenant-1');
    // The gateway adds the client identity for downstream audit.
    expect(last.headers['x-forwarded-for']).toBeDefined();
    await app.close();
  });

  it('returns 502 when the upstream is unreachable', async () => {
    // Point at a closed port.
    const app = await buildGateway('http://127.0.0.1:1');
    const res = await app.inject({ method: 'GET', url: '/api/v1/students/1' });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('BAD_GATEWAY');
    await app.close();
  });

  it('returns 504 when the upstream exceeds the timeout', async () => {
    upstreamDelayMs = 100;
    const app = await buildGateway(upstreamUrl, 20);
    const res = await app.inject({ method: 'GET', url: '/api/v1/students/slow' });
    expect(res.statusCode).toBe(504);
    expect(res.json().code).toBe('GATEWAY_TIMEOUT');
    upstreamDelayMs = 0;
    await app.close();
  });

  it('exposes the service registry without proxying', async () => {
    const app = await buildGateway(upstreamUrl);
    const res = await app.inject({ method: 'GET', url: '/api/v1/services' });
    expect(res.statusCode).toBe(200);
    expect(res.json().services).toContainEqual(
      expect.objectContaining({ name: 'students', prefix: '/api/v1/students' }),
    );
    await app.close();
  });
});
