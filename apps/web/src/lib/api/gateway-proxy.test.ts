// @vitest-environment node
/**
 * PRC-M134: the shared gateway proxy helper must bound the upstream call with a
 * timeout (504), cap the request body while streaming it (413, no full buffer
 * first), stream the upstream response, map transport failures to 502, and
 * reject unsafe paths (400) and unauthenticated callers (401).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionContext = vi.fn();
vi.mock('@/lib/api/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/gateway')>('@/lib/api/gateway');
  return { ...actual, getSessionContext: (...a: unknown[]) => getSessionContext(...a) };
});

import { proxyToGateway } from './gateway-proxy';

const ORIGINAL_FETCH = global.fetch;

function req(method: string, body?: BodyInit): Request {
  return new Request('https://app.example.com/api/scholarships/programs', {
    method,
    ...(body ? { body } : {}),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  getSessionContext.mockReset();
  getSessionContext.mockResolvedValue({ tenantId: 't-1', accessToken: 'tok' });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('proxyToGateway (PRC-M134)', () => {
  it('rejects path traversal with 400 and never calls upstream', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const res = await proxyToGateway(req('GET'), ['..', 'secrets'], { prefix: 'scholarships' });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session token', async () => {
    getSessionContext.mockResolvedValue({ tenantId: 't-1', accessToken: null });
    const res = await proxyToGateway(req('GET'), ['programs'], { prefix: 'scholarships' });
    expect(res.status).toBe(401);
  });

  it('maps an upstream timeout to 504', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new DOMException('timeout', 'TimeoutError')) as unknown as typeof fetch;
    const res = await proxyToGateway(req('GET'), ['programs'], { prefix: 'scholarships' });
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe('GATEWAY_TIMEOUT');
  });

  it('maps a transport failure to 502', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('connect ECONNREFUSED')) as unknown as typeof fetch;
    const res = await proxyToGateway(req('GET'), ['programs'], { prefix: 'scholarships' });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('BAD_GATEWAY');
  });

  it('rejects an oversized body with 413 before calling upstream', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const big = 'x'.repeat(1024);
    const res = await proxyToGateway(req('POST', big), ['programs'], {
      prefix: 'scholarships',
      maxBodyBytes: 10,
    });
    expect(res.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards a successful upstream response with a bounded signal', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;
    const res = await proxyToGateway(req('GET'), ['programs'], { prefix: 'scholarships' });
    expect(res.status).toBe(200);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((fetchSpy.mock.calls[0]![0] as URL).toString()).toContain('/scholarships/programs');
  });
});

/** A request body stream that counts how many chunks were pulled from it. */
function countingStream(chunks: number, chunkBytes: number) {
  const state = { pulls: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls += 1;
        if (state.pulls > chunks) controller.close();
        else controller.enqueue(new Uint8Array(chunkBytes).fill(120));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

function streamingReq(stream: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new Request('https://app.example.com/api/scholarships/programs', {
    method: 'POST',
    body: stream,
    headers,
    duplex: 'half',
  } as RequestInit);
}

describe('proxyToGateway streaming limits (PRC-M134)', () => {
  it('rejects a declared content-length above the cap without reading the body', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { stream, state } = countingStream(4, 1024);
    const request = streamingReq(stream, {
      'content-type': 'application/json',
      'content-length': '4096',
    });
    expect(request.headers.get('content-length')).toBe('4096');
    const res = await proxyToGateway(request, ['programs'], {
      prefix: 'scholarships',
      maxBodyBytes: 10,
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.pulls).toBe(0);
  });

  it('stops reading an undeclared oversized stream as soon as the cap is passed', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { stream, state } = countingStream(64, 1024);
    const res = await proxyToGateway(
      streamingReq(stream, { 'content-type': 'application/json' }),
      ['programs'],
      { prefix: 'scholarships', maxBodyBytes: 2048 },
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.pulls).toBeLessThanOrEqual(4);
  });

  it('forwards an in-cap body byte-exact', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    global.fetch = fetchSpy as unknown as typeof fetch;
    const payload = JSON.stringify({ name: 'Merit award', amount: 1250 });
    const res = await proxyToGateway(req('POST', payload), ['programs'], {
      prefix: 'scholarships',
    });
    expect(res.status).toBe(201);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(Buffer.from(init.body as Uint8Array).toString('utf8')).toBe(payload);
  });

  it('streams the upstream body instead of buffering it', async () => {
    const payload = JSON.stringify({ data: [{ id: 'p-1' }] });
    const upstream = new Response(payload, {
      status: 202,
      headers: { 'content-type': 'application/vnd.test+json' },
    });
    const bufferSpy = vi.spyOn(upstream, 'arrayBuffer');
    global.fetch = vi.fn().mockResolvedValue(upstream) as unknown as typeof fetch;
    const res = await proxyToGateway(req('GET'), ['programs'], { prefix: 'scholarships' });
    expect(bufferSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(202);
    expect(res.headers.get('content-type')).toBe('application/vnd.test+json');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe(payload);
  });
});
