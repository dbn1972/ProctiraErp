/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CROSS_BOARD_TRANSFER_MOCK } from './mockData';
import { useCrossBoardTransferData } from './queries';

describe('useCrossBoardTransferData', () => {
  it('reports the missing transfer API instead of returning mock data', async () => {
    const { result } = renderHook(() => useCrossBoardTransferData('missing-transfer'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/pending workflow detail/i);
    expect(result.current.data).not.toEqual(CROSS_BOARD_TRANSFER_MOCK);
  });
});
