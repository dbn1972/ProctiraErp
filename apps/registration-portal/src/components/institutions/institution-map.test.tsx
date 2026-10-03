/**
 * PRC-M051 / PRC-M056 — directory uses real type ids, searches server-side and
 * paginates beyond the first page (e.g. the 201st school is reachable).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstitutionLocation } from '@/lib/api';
import { resolveTypeFilter, typeTileHref } from '@/lib/institution-filters';

const getInstitutions = vi.fn();
vi.mock('@/lib/api', () => ({ getInstitutions: (...args: unknown[]) => getInstitutions(...args) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.count ? `${key}:${values.count}` : key,
}));

const { InstitutionMap } = await import('./institution-map');

function school(i: number): InstitutionLocation {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `School ${i}`,
    code: `S${i}`,
    typeId: 't',
    typeName: 'Primary',
    areaId: 'a',
    areaName: 'Area',
    latitude: null,
    longitude: null,
    address: null,
  } as InstitutionLocation;
}

afterEach(() => {
  getInstitutions.mockReset();
  vi.useRealTimers();
});

describe('PRC-M051 type filter helpers', () => {
  const options = { types: [{ id: 'uuid-primary', name: 'Primary' }], areas: [], grades: [] };
  it('tiles link with the real type id', () => {
    expect(typeTileHref({ id: 'uuid-primary' })).toBe('/schools?typeId=uuid-primary');
  });
  it('unknown typeId is an invalid filter; outage is unknown, not invalid', () => {
    expect(resolveTypeFilter('primary', options)).toBe('invalid');
    expect(resolveTypeFilter('uuid-primary', options)).toBe('valid');
    expect(resolveTypeFilter('primary', null)).toBe('unknown');
    expect(resolveTypeFilter(undefined, options)).toBe('none');
  });
});

describe('PRC-M056 directory pagination + server search', () => {
  it('Load more fetches the next page so later schools are reachable', async () => {
    const first = Array.from({ length: 100 }, (_, i) => school(i + 1));
    getInstitutions.mockResolvedValueOnce({
      data: Array.from({ length: 100 }, (_, i) => school(i + 101)),
      meta: { page: 2, pageSize: 100, totalItems: 250, totalPages: 3 },
    });
    getInstitutions.mockResolvedValueOnce({
      data: Array.from({ length: 50 }, (_, i) => school(i + 201)),
      meta: { page: 3, pageSize: 100, totalItems: 250, totalPages: 3 },
    });
    render(<InstitutionMap initialInstitutions={first} initialTotal={250} />);
    expect(getInstitutions).not.toHaveBeenCalled();
    expect(screen.getByText('resultsCount:250')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('loadMore'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('loadMore'));
    });
    expect(getInstitutions.mock.calls.map((c) => (c[0] as { page: number }).page)).toEqual([2, 3]);
    expect(screen.getByText('School 201')).toBeTruthy();
    expect(screen.queryByText('loadMore')).toBeNull();
  });

  it('search is sent to the API (not filtered client-side over page 1)', async () => {
    vi.useFakeTimers();
    getInstitutions.mockResolvedValue({
      data: [school(201)],
      meta: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
    });
    render(<InstitutionMap initialInstitutions={[school(1)]} initialTotal={1} />);
    fireEvent.change(screen.getByLabelText('searchPlaceholder'), {
      target: { value: 'School 201' },
    });
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(getInstitutions).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'School 201', page: 1 }),
    );
  });
});
