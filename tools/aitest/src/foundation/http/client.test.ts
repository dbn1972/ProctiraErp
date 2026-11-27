import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiClient } from './client.js';

let seen: IncomingMessage & { body?: string };
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d: Buffer) => (body += d.toString()));
  req.on('end', () => {
    seen = Object.assign(req, { body });
    if (req.url?.startsWith('/redirect')) {
      res.writeHead(302, { location: 'https://evil.example/' }).end();
      return;
    }
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: true, url: req.url }));
  });
});
let base = '';
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

describe('ApiClient', () => {
  it('sends JSON with principal auth and tenant header', async () => {
    const c = new ApiClient(base, { mint: (p) => `tok-${p.sub}` });
    const r = await c
      .as({ sub: 'u1', tenantId: 't1', roles: [] })
      .post('/x', { a: 1 }, { query: { q: '1 2' } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, url: '/x?q=1+2' });
    expect(seen.headers['authorization']).toBe('Bearer tok-u1');
    expect(seen.headers['x-tenant-id']).toBe('t1');
    expect(seen.headers['content-type']).toBe('application/json');
    expect(seen.body).toBe('{"a":1}');
  });

  it('supports raw tokens, anonymous calls, raw bodies and does not follow redirects', async () => {
    const c = new ApiClient(base).as({ token: 'raw' });
    await c.get('/y');
    expect(seen.headers['authorization']).toBe('Bearer raw');
    await c.as(null).request('PUT', '/z', {
      rawBody: Buffer.from([1, 2, 3]),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(seen.headers['authorization']).toBeUndefined();
    expect(seen.body).toBe('\u0001\u0002\u0003');
    const r = await c.get('/redirect');
    expect(r.status).toBe(302);
    expect(r.headers['location']).toBe('https://evil.example/');
    expect(() => new ApiClient(base).as({ sub: 'u', tenantId: 't', roles: [] })).toThrow(/mint/);
  });
});
