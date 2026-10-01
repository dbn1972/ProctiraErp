import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const fetchMock = vi.fn();
vi.mock('@/lib/api/browser-gateway', () => ({
  browserGatewayFetch: (path: string) => fetchMock(path),
}));

import InstitutionsList, { SEARCH_DEBOUNCE_MS } from './InstitutionsList';

function page(name: string, totalPages = 1) {
  return {
    data: [{ id: `id-${name}`, code: name.toUpperCase(), name, status: 'ACTIVE', areaId: null }],
    meta: { page: 1, pageSize: 20, totalItems: 1, totalPages },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('InstitutionsList search (PRC-L072)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("typing 'abc' quickly sends one search and ends with results for 'abc'", async () => {
    fetchMock.mockResolvedValueOnce(page('initial'));
    render(<InstitutionsList />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const input = screen.getByRole('textbox', { name: 'Search institutions' });
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(page(new URLSearchParams(path.split('?')[1]).get('search') ?? '')),
    );
    for (const value of ['a', 'ab', 'abc']) {
      fireEvent.change(input, { target: { value } });
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('search=abc');
    expect(screen.getByRole('link', { name: 'abc' })).toHaveAttribute(
      'href',
      '/institutions/id-abc',
    );
  });

  it('ignores a stale response that resolves after a newer one', async () => {
    let resolveSlow: (v: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((r) => (resolveSlow = r)));
    render(<InstitutionsList />);

    fetchMock.mockResolvedValueOnce(page('abc', 3));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search institutions' }), {
      target: { value: 'abc' },
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    await flush();
    resolveSlow(page('stale'));
    await flush();

    expect(screen.getByRole('link', { name: 'abc' })).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Institutions pagination' })).toBeInTheDocument();
  });
});
