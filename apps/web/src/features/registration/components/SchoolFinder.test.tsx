/**
 * @vitest-environment jsdom
 *
 * SchoolFinder unit tests (Task 51.3 / Requirements 16.4, 16.9).
 *
 * Covers:
 *   • Geolocation prompt: requests `navigator.geolocation`, falls back
 *     gracefully on permission denial, and exposes a "clear location"
 *     control once coordinates are captured.
 *   • Manual filter form: search box, area / type / grade selects,
 *     submitting issues a fetch with the expected query string.
 *   • Results list: renders rows with distance when present, exposes
 *     keyboard navigation (Arrow Up / Down / Home / End on the listbox),
 *     and disables Add when the parent reports the maximum is reached.
 *   • Pagination: Prev / Next buttons trigger fresh fetches and the
 *     count label reflects `totalItems / totalPages` from the response.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SchoolFinder } from './SchoolFinder';
import type { SchoolFinderResult } from '@/lib/api/registration';

const ALPHA: SchoolFinderResult = {
  id: 'a',
  name: 'Alpha High',
  code: 'ALPHA-001',
  typeId: 'type-secondary',
  typeName: 'Secondary',
  areaId: 'area-north',
  areaName: 'North District',
  latitude: 12.97,
  longitude: 77.59,
  address: '1 Alpha Rd',
  distanceKm: 1.2,
};

const BETA: SchoolFinderResult = {
  id: 'b',
  name: 'Beta School',
  code: 'BETA-001',
  typeId: 'type-primary',
  typeName: 'Primary',
  areaId: 'area-south',
  areaName: 'South District',
  latitude: 12.95,
  longitude: 77.59,
  address: null,
};

function makeFetcher(
  responses: Array<{ data: SchoolFinderResult[]; totalItems: number; totalPages: number }>,
): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fn: typeof fetch = vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    calls.push(url);
    const r = responses[Math.min(i, responses.length - 1)] ?? {
      data: [],
      totalItems: 0,
      totalPages: 0,
    };
    i += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: r.data,
        meta: {
          page: 1,
          pageSize: 10,
          totalItems: r.totalItems,
          totalPages: r.totalPages,
        },
      }),
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('<SchoolFinder>', () => {
  beforeEach(() => {
    // Default to a pristine geolocation API; individual tests override.
    Object.defineProperty(globalThis, 'navigator', {
      value: { geolocation: undefined },
      writable: true,
      configurable: true,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the geolocation prompt and the manual filter form', () => {
    render(<SchoolFinder selectedIds={[]} onAddPreference={() => undefined} />);
    expect(screen.getByTestId('school-finder-use-location')).toBeTruthy();
    expect(screen.getByTestId('school-finder-search')).toBeTruthy();
    expect(screen.getByTestId('school-finder-area')).toBeTruthy();
    expect(screen.getByTestId('school-finder-type')).toBeTruthy();
    expect(screen.getByTestId('school-finder-grade')).toBeTruthy();
  });

  it('runs a search on submit and renders the result rows', async () => {
    const { fn, calls } = makeFetcher([{ data: [ALPHA, BETA], totalItems: 2, totalPages: 1 }]);
    render(<SchoolFinder selectedIds={[]} onAddPreference={() => undefined} fetcher={fn} />);

    fireEvent.submit(screen.getByTestId('school-finder-filters'));

    await waitFor(() => {
      expect(screen.getByTestId('school-finder-result-a')).toBeTruthy();
      expect(screen.getByTestId('school-finder-result-b')).toBeTruthy();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/api/v1/registration/schools/search');
    expect(calls[0]).toContain('page=1');
    expect(calls[0]).toContain('pageSize=10');
    expect(screen.getByTestId('school-finder-distance-a').textContent).toContain('1.2 km');
  });

  it('forwards manual filters to the query string', async () => {
    const { fn, calls } = makeFetcher([{ data: [], totalItems: 0, totalPages: 0 }]);
    render(
      <SchoolFinder
        selectedIds={[]}
        onAddPreference={() => undefined}
        areaOptions={[{ value: 'area-north', label: 'North' }]}
        schoolTypeOptions={[{ value: 'type-secondary', label: 'Secondary' }]}
        gradeOptions={[{ value: 'grade-9', label: 'Grade 9' }]}
        fetcher={fn}
      />,
    );

    fireEvent.change(screen.getByTestId('school-finder-search'), {
      target: { value: 'lincoln' },
    });
    fireEvent.change(screen.getByTestId('school-finder-area'), {
      target: { value: 'area-north' },
    });
    fireEvent.change(screen.getByTestId('school-finder-type'), {
      target: { value: 'type-secondary' },
    });
    fireEvent.change(screen.getByTestId('school-finder-grade'), {
      target: { value: 'grade-9' },
    });
    fireEvent.submit(screen.getByTestId('school-finder-filters'));

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const url = calls[0]!;
    expect(url).toContain('search=lincoln');
    expect(url).toContain('areaIds=area-north');
    expect(url).toContain('schoolTypes=type-secondary');
    expect(url).toContain('gradeLevels=grade-9');
  });

  it('emits onAddPreference when the Add button is clicked', async () => {
    const { fn } = makeFetcher([{ data: [ALPHA], totalItems: 1, totalPages: 1 }]);
    const onAdd = vi.fn();
    render(<SchoolFinder selectedIds={[]} onAddPreference={onAdd} fetcher={fn} />);
    fireEvent.submit(screen.getByTestId('school-finder-filters'));
    await waitFor(() => expect(screen.getByTestId('school-finder-result-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('school-finder-add-a'));
    expect(onAdd).toHaveBeenCalledWith(ALPHA);
  });

  it('renders Added pill and disables Add when school already in selection', async () => {
    const { fn } = makeFetcher([{ data: [ALPHA, BETA], totalItems: 2, totalPages: 1 }]);
    render(
      <SchoolFinder
        selectedIds={['a']}
        onAddPreference={() => undefined}
        onRemovePreference={() => undefined}
        fetcher={fn}
      />,
    );
    fireEvent.submit(screen.getByTestId('school-finder-filters'));
    await waitFor(() => expect(screen.getByTestId('school-finder-remove-a')).toBeTruthy());
    expect(screen.queryByTestId('school-finder-add-a')).toBeNull();
    // Beta is still addable.
    expect(screen.getByTestId('school-finder-add-b')).toBeTruthy();
  });

  it('disables Add for new rows when max preferences is reached', async () => {
    const { fn } = makeFetcher([{ data: [ALPHA, BETA], totalItems: 2, totalPages: 1 }]);
    render(
      <SchoolFinder
        selectedIds={['x', 'y', 'z']}
        maxPreferences={3}
        onAddPreference={() => undefined}
        fetcher={fn}
      />,
    );
    fireEvent.submit(screen.getByTestId('school-finder-filters'));
    await waitFor(() => expect(screen.getByTestId('school-finder-result-a')).toBeTruthy());
    const addA = screen.getByTestId('school-finder-add-a') as HTMLButtonElement;
    const addB = screen.getByTestId('school-finder-add-b') as HTMLButtonElement;
    expect(addA.disabled).toBe(true);
    expect(addB.disabled).toBe(true);
  });

  it('captures geolocation and includes lat/lng/radius in the query', async () => {
    // Stub navigator.geolocation
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 12.95,
          longitude: 77.59,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: { geolocation: { getCurrentPosition } },
      writable: true,
      configurable: true,
    });

    const { fn, calls } = makeFetcher([{ data: [ALPHA], totalItems: 1, totalPages: 1 }]);
    render(<SchoolFinder selectedIds={[]} onAddPreference={() => undefined} fetcher={fn} />);

    fireEvent.click(screen.getByTestId('school-finder-use-location'));
    await waitFor(() => expect(screen.getByTestId('school-finder-clear-location')).toBeTruthy());
    fireEvent.submit(screen.getByTestId('school-finder-filters'));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));

    const url = calls[0]!;
    expect(url).toContain('latitude=12.95');
    expect(url).toContain('longitude=77.59');
    expect(url).toContain('radiusKm=10'); // default
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('falls back to a friendly error when geolocation permission is denied', async () => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error: PositionErrorCallback | undefined) => {
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError);
      },
    );
    Object.defineProperty(globalThis, 'navigator', {
      value: { geolocation: { getCurrentPosition } },
      writable: true,
      configurable: true,
    });

    render(<SchoolFinder selectedIds={[]} onAddPreference={() => undefined} />);
    fireEvent.click(screen.getByTestId('school-finder-use-location'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent ?? '').toContain('denied');
    });
    // Manual filter form remains the fallback path.
    expect(screen.getByTestId('school-finder-filters')).toBeTruthy();
  });

  it('exposes pagination controls when totalPages > 1', async () => {
    const { fn, calls } = makeFetcher([
      { data: [ALPHA], totalItems: 25, totalPages: 3 },
      { data: [BETA], totalItems: 25, totalPages: 3 },
    ]);
    render(<SchoolFinder selectedIds={[]} onAddPreference={() => undefined} fetcher={fn} />);
    fireEvent.submit(screen.getByTestId('school-finder-filters'));
    await waitFor(() => expect(screen.getByTestId('school-finder-pagination')).toBeTruthy());
    fireEvent.click(screen.getByTestId('school-finder-next'));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    expect(calls[1]).toContain('page=2');
  });

  it('shows the empty-state hint when zero results match', async () => {
    const { fn } = makeFetcher([{ data: [], totalItems: 0, totalPages: 0 }]);
    render(<SchoolFinder selectedIds={[]} onAddPreference={() => undefined} fetcher={fn} />);
    fireEvent.submit(screen.getByTestId('school-finder-filters'));
    await waitFor(() => expect(screen.getByTestId('school-finder-empty')).toBeTruthy());
  });

  it('navigates the results list with arrow keys', async () => {
    const { fn } = makeFetcher([{ data: [ALPHA, BETA], totalItems: 2, totalPages: 1 }]);
    render(<SchoolFinder selectedIds={[]} onAddPreference={() => undefined} fetcher={fn} />);
    fireEvent.submit(screen.getByTestId('school-finder-filters'));
    await waitFor(() => expect(screen.getByTestId('school-finder-result-a')).toBeTruthy());

    const list = screen.getByTestId('school-finder-results-list');
    const rowA = screen.getByTestId('school-finder-result-a');
    const rowB = screen.getByTestId('school-finder-result-b');

    rowA.focus();
    expect(document.activeElement).toBe(rowA);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowB);
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rowA);
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement).toBe(rowB);
    fireEvent.keyDown(list, { key: 'Home' });
    expect(document.activeElement).toBe(rowA);
  });
});
