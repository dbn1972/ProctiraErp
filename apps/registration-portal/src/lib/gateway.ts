/**
 * Server-only transport from the registration portal to the API gateway.
 *
 * Import only from server components, route handlers, and `lib/server.ts`
 * (uses node:http and next/headers).
 */
import http from 'node:http';
import https from 'node:https';

import type { RegistrationRequestInit, RegistrationTransport } from './api';
import { getGatewayApiBaseUrl } from './gateway-config';

const GATEWAY_TIMEOUT_MS = 15_000;

/** Options for a single gateway request. */
export interface GatewayRequestOptions {
  /** Gateway API base; defaults to {@link getGatewayApiBaseUrl}. */
  baseUrl?: string;
}

/**
 * Performs one request against the gateway (`<base>/api/v1<path>`) and returns
 * a standard `Response`.
 */
export function gatewayRequest(
  path: string,
  init: RegistrationRequestInit = {},
  options: GatewayRequestOptions = {},
): Promise<Response> {
  const base = options.baseUrl ?? getGatewayApiBaseUrl();
  const url = new URL(`${base.replace(/\/+$/, '')}${path}`);
  const transport = url.protocol === 'https:' ? https : http;
  const headers: Record<string, string> = { accept: 'application/json', ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['content-length'] = String(Buffer.byteLength(init.body));

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: init.method ?? 'GET',
        headers,
        timeout: GATEWAY_TIMEOUT_MS,
        servername: url.hostname,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const status = res.statusCode ?? 502;
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            for (const v of Array.isArray(value) ? value : [value]) responseHeaders.append(name, v);
          }
          const noBody = status === 204 || status === 304;
          resolve(
            new Response(noBody ? null : Buffer.concat(chunks), {
              status,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Gateway request timed out')));
    req.on('error', reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/** Transport for server components and loaders. */
export const serverTransport: RegistrationTransport = (path, init) => gatewayRequest(path, init);
