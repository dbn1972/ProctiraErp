/**
 * Small HTTP client for gateway probing. Never follows redirects (security
 * suites must see them), never throws on an HTTP status, records latency.
 */
import type { Principal } from '../auth/tokens.js';

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json?: unknown;
  ms: number;
}

export type ApiAuth = Principal | { token: string; tenantId?: string } | null;

export interface RequestOptions {
  query?: Record<string, string>;
  body?: unknown;
  rawBody?: string | Buffer;
  headers?: Record<string, string>;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly mint?: (p: Principal) => string;

  constructor(
    baseUrl: string,
    o: {
      timeoutMs?: number;
      defaultHeaders?: Record<string, string>;
      /** Signs Principal auth (StackContext supplies the stack's token factory). */
      mint?: (p: Principal) => string;
    } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.defaultHeaders = o.defaultHeaders ?? {};
    if (o.mint) this.mint = o.mint;
  }

  /** A client bound to a principal, a raw token, or nobody (null = anonymous). */
  as(auth: ApiAuth): ApiClient {
    const headers = { ...this.defaultHeaders };
    delete headers['authorization'];
    delete headers['x-tenant-id'];
    if (auth) {
      let token: string;
      let tenantId: string | undefined;
      if ('token' in auth) {
        token = auth.token;
        tenantId = auth.tenantId;
      } else {
        if (!this.mint) throw new Error('ApiClient.as(principal) needs a mint function');
        token = this.mint(auth);
        tenantId = auth.tenantId;
      }
      headers['authorization'] = `Bearer ${token}`;
      if (tenantId) headers['x-tenant-id'] = tenantId;
    }
    return new ApiClient(this.baseUrl, {
      timeoutMs: this.timeoutMs,
      defaultHeaders: headers,
      ...(this.mint ? { mint: this.mint } : {}),
    });
  }

  url(path: string, query?: Record<string, string>): string {
    const u = new URL(
      path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`,
    );
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u.toString();
  }

  async request(method: string, path: string, o: RequestOptions = {}): Promise<ApiResponse> {
    const headers: Record<string, string> = { ...this.defaultHeaders, ...o.headers };
    let body: string | ArrayBuffer | undefined;
    if (o.rawBody !== undefined) {
      body = typeof o.rawBody === 'string' ? o.rawBody : Uint8Array.from(o.rawBody).buffer;
    } else if (o.body !== undefined) {
      body = JSON.stringify(o.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['content-type'] = 'application/json';
      }
    }
    const started = performance.now();
    const res = await fetch(this.url(path, o.query), {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (outHeaders[k] = v));
    let json: unknown;
    if ((outHeaders['content-type'] ?? '').includes('json') && text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    return {
      status: res.status,
      headers: outHeaders,
      text,
      ...(json !== undefined ? { json } : {}),
      ms,
    };
  }

  get(path: string, o?: RequestOptions) {
    return this.request('GET', path, o);
  }
  post(path: string, body?: unknown, o?: RequestOptions) {
    return this.request('POST', path, { ...o, body });
  }
  put(path: string, body?: unknown, o?: RequestOptions) {
    return this.request('PUT', path, { ...o, body });
  }
  patch(path: string, body?: unknown, o?: RequestOptions) {
    return this.request('PATCH', path, { ...o, body });
  }
  delete(path: string, o?: RequestOptions) {
    return this.request('DELETE', path, o);
  }
}
