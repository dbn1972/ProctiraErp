/**
 * @vitest-environment node
 *
 * PRC-M294 — library list clients follow the paged `{ data, meta }` responses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetchMock = vi.fn();

vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetchMock(...args),
  GATEWAY_API_PREFIX: '/api/v1',
  GATEWAY_BASE_URL: 'http://gateway.test',
  GatewayError: class extends Error {},
  getSessionContext: vi.fn(),
}));

import {
  listLibraryFines,
  listLibraryHoldsResult,
  listLibraryItemsResult,
  listLibraryLoansResult,
  listLibraryOverduesResult,
} from './library';
import { MAX_API_PAGE_SIZE } from './pagination';

const TOTAL = 250;

function serve(total: number) {
  return (path: string) => {
    const query = new URLSearchParams(path.split('?')[1]);
    const page = Number(query.get('page'));
    const pageSize = Number(query.get('pageSize'));
    const start = (page - 1) * pageSize;
    const data = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) => ({
      id: `row-${start + i}`,
    }));
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        data,
        meta: { page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  };
}

const forbidden = { ok: false, status: 403, error: { code: 'FORBIDDEN' } };
const unavailable = { ok: false, status: 503, error: { code: 'UNAVAILABLE' } };

const resultReaders = [
  ['listLibraryItemsResult', () => listLibraryItemsResult(), '/library/items?'],
  ['listLibraryOverduesResult', () => listLibraryOverduesResult(), '/library/overdues?'],
  [
    'listLibraryLoansResult',
    () => listLibraryLoansResult({ studentId: 'stu-1' }),
    '/library/loans?studentId=stu-1&',
  ],
  [
    'listLibraryHoldsResult',
    () => listLibraryHoldsResult({ itemId: 'item-1' }),
    '/library/holds?itemId=item-1&',
  ],
] as const;

beforeEach(() => {
  gatewayFetchMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(resultReaders)('%s (PRC-M294)', (_name, read, prefix) => {
  it('follows meta.totalPages and concatenates every page', async () => {
    gatewayFetchMock.mockImplementation(serve(TOTAL));
    const result = await read();
    expect(result.ok).toBe(true);
    expect(result.ok && result.items).toHaveLength(TOTAL);
    expect(gatewayFetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${prefix}page=1&pageSize=${MAX_API_PAGE_SIZE}`,
      `${prefix}page=2&pageSize=${MAX_API_PAGE_SIZE}`,
      `${prefix}page=3&pageSize=${MAX_API_PAGE_SIZE}`,
    ]);
  });

  it('returns the first-page failure as a ListResult failure', async () => {
    gatewayFetchMock.mockResolvedValue(forbidden);
    const result = await read();
    expect(result).toEqual({ ok: false, kind: 'denied', status: 403, code: 'FORBIDDEN' });
    expect(gatewayFetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the pages already read when a later page fails', async () => {
    gatewayFetchMock.mockImplementationOnce(serve(TOTAL)).mockResolvedValueOnce(unavailable);
    const result = await read();
    expect(result.ok && result.items).toHaveLength(MAX_API_PAGE_SIZE);
    expect(gatewayFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('listLibraryFines (PRC-M294)', () => {
  it('follows meta.totalPages', async () => {
    gatewayFetchMock.mockImplementation(serve(TOTAL));
    expect(await listLibraryFines('stu-1')).toHaveLength(TOTAL);
    expect(gatewayFetchMock.mock.calls[0]?.[0]).toBe(
      `/library/fines?studentId=stu-1&page=1&pageSize=${MAX_API_PAGE_SIZE}`,
    );
    expect(gatewayFetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns [] when the first page fails', async () => {
    gatewayFetchMock.mockResolvedValue(forbidden);
    expect(await listLibraryFines()).toEqual([]);
  });

  it('returns the pages already read when a later page fails', async () => {
    gatewayFetchMock.mockImplementationOnce(serve(TOTAL)).mockResolvedValueOnce(unavailable);
    expect(await listLibraryFines()).toHaveLength(MAX_API_PAGE_SIZE);
  });
});
