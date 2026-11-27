/**
 * HTTP request with an explicit Host header. The public registration routes
 * resolve the tenant only from the raw Host (registration routes.ts), and
 * fetch does not let a caller set Host, so this uses node:http directly.
 */
import http from 'node:http';

import type { ApiResponse } from '../../foundation/index.js';
export async function hostRequest(
  baseUrl: string,
  host: string,
  method: string,
  path: string,
  o: { body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ApiResponse> {
  const url = new URL(baseUrl);
  const payload = o.body === undefined ? undefined : JSON.stringify(o.body);
  const started = performance.now();
  return new Promise<ApiResponse>((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path,
        method,
        timeout: o.timeoutMs ?? 30_000,
        headers: {
          ...o.headers,
          host,
          ...(payload !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v;
          }
          let json: unknown;
          if ((headers['content-type'] ?? '').includes('json') && text) {
            try {
              json = JSON.parse(text);
            } catch {
              json = undefined;
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            headers,
            text,
            ...(json !== undefined ? { json } : {}),
            ms: Math.round(performance.now() - started),
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    req.end(payload);
  });
}
