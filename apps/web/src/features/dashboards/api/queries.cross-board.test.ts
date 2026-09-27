/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CROSS_BOARD_TRANSFER_MOCK } from './mockData';
import { useCrossBoardTransferData } from './queries';

describe('useCrossBoardTransferData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces a gateway miss for the transfer and does not substitute mock data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Transfer not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCrossBoardTransferData('missing-transfer'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/api/v1/transfers/missing-transfer');
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/transfer not found/i);
    expect(result.current.data).not.toEqual(CROSS_BOARD_TRANSFER_MOCK);
  });
});
