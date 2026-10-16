/**
 * ISBN lookup resilience tests (PRC-L328).
 *
 * The OpenLibrary adapter must bound outbound calls with an abort timeout and
 * map any transport failure / non-JSON body to a retryable 503 AppError rather
 * than hanging the handler or surfacing an unhandled 500.
 */
import { AppError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { OpenLibraryIsbnLookup, StubIsbnLookup } from './isbn-lookup.js';

describe('OpenLibraryIsbnLookup (PRC-L328)', () => {
  it('aborts a hanging upstream within the timeout and raises a 503', async () => {
    // A fetch that respects the AbortSignal and never resolves otherwise.
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }
      });

    const lookup = new OpenLibraryIsbnLookup(hangingFetch, 50);
    const start = Date.now();
    // Would hang forever (and eventually surface as 500) before the fix.
    await expect(lookup.lookup('9780262033848')).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.statusCode === 503,
    );
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('maps a non-JSON upstream body to a 503', async () => {
    const badFetch: typeof fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      }) as unknown as Response;

    const lookup = new OpenLibraryIsbnLookup(badFetch, 1000);
    await expect(lookup.lookup('9780262033848')).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.statusCode === 503,
    );
  });

  it('maps a 5xx upstream to a 503 but a 404 to null', async () => {
    const makeFetch =
      (status: number): typeof fetch =>
      async () =>
        ({ ok: status < 400, status, json: async () => ({}) }) as unknown as Response;

    await expect(
      new OpenLibraryIsbnLookup(makeFetch(502), 1000).lookup('9780262033848'),
    ).rejects.toSatisfy((err: unknown) => err instanceof AppError && err.statusCode === 503);
    await expect(
      new OpenLibraryIsbnLookup(makeFetch(404), 1000).lookup('9780262033848'),
    ).resolves.toBeNull();
  });

  it('stub lookup never touches the network', async () => {
    const stub = new StubIsbnLookup();
    const result = await stub.lookup('9780262033848');
    expect(result?.title).toBe('Clean Code');
  });
});
