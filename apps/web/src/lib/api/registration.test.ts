/**
 * Tests for the public registration tracking API client (Task 51.4).
 *
 * Validates:
 *   • the request is dispatched against `/api/v1/registration/applications/{trackingNumber}`
 *   • a 200 JSON body is normalized to the strict client shape
 *   • a 404 response collapses to `kind: 'not_found'` (Requirement 16.6)
 *   • non-2xx responses become `kind: 'error'`
 *   • network failures become `kind: 'error'`
 *   • empty / whitespace tracking numbers are rejected before the network call
 */

import { describe, expect, it, vi } from 'vitest';

import {
  REGISTRATION_API_PREFIX,
  getApplicationByTrackingNumber,
  normalizeTrackingResult,
} from './registration';

function makeFetcher(response: Partial<Response> & { jsonValue?: unknown }) {
  return vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        json: async () => response.jsonValue ?? {},
      }) as Response,
  );
}

describe('getApplicationByTrackingNumber', () => {
  it('returns kind:"error" without calling fetch when the tracking number is empty', async () => {
    const fetcher = vi.fn();
    const result = await getApplicationByTrackingNumber('   ', { fetcher });
    expect(result.kind).toBe('error');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('calls the public endpoint with the encoded tracking number', async () => {
    const fetcher = makeFetcher({
      ok: true,
      status: 200,
      jsonValue: {
        trackingNumber: 'REG-A1B2C3D4',
        status: 'pending',
        submittedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
        history: [],
        followUpActions: [],
      },
    });

    await getApplicationByTrackingNumber('REG-A1B2C3D4', { fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const firstCall = fetcher.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, init] = firstCall as [RequestInfo | URL, RequestInit?];
    expect(String(url)).toContain(`${REGISTRATION_API_PREFIX}/REG-A1B2C3D4`);
    expect(init?.method).toBe('GET');
  });

  it('encodes special characters in the tracking number path segment', async () => {
    const fetcher = makeFetcher({
      ok: true,
      status: 200,
      jsonValue: { history: [], followUpActions: [] },
    });
    await getApplicationByTrackingNumber('REG/with space', { fetcher });
    const firstCall = fetcher.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url] = firstCall as [RequestInfo | URL, RequestInit?];
    expect(String(url)).toContain('REG%2Fwith%20space');
  });

  it('returns kind:"ok" with normalized data on 200', async () => {
    const fetcher = makeFetcher({
      ok: true,
      status: 200,
      jsonValue: {
        trackingNumber: 'REG-XYZ',
        status: 'under_review',
        submittedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-03T00:00:00Z',
        currentStep: 'Document review',
        history: [
          { status: 'pending', timestamp: '2025-01-01T00:00:00Z' },
          {
            status: 'under_review',
            timestamp: '2025-01-03T00:00:00Z',
            note: 'Documents received',
          },
        ],
        followUpActions: [
          { code: 'UPLOAD_BIRTH_CERT', message: 'Please upload a birth certificate' },
        ],
      },
    });

    const result = await getApplicationByTrackingNumber('REG-XYZ', { fetcher });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.trackingNumber).toBe('REG-XYZ');
      expect(result.data.status).toBe('under_review');
      expect(result.data.currentStep).toBe('Document review');
      expect(result.data.history).toHaveLength(2);
      expect(result.data.followUpActions).toHaveLength(1);
    }
  });

  it('collapses 404 to kind:"not_found"', async () => {
    const fetcher = makeFetcher({ ok: false, status: 404 });
    const result = await getApplicationByTrackingNumber('REG-MISSING', {
      fetcher,
    });
    expect(result.kind).toBe('not_found');
  });

  it('returns kind:"error" for 5xx responses', async () => {
    const fetcher = makeFetcher({ ok: false, status: 500 });
    const result = await getApplicationByTrackingNumber('REG-X', { fetcher });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('500');
    }
  });

  it('returns kind:"error" when fetch throws (network failure)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('Network down');
    });
    const result = await getApplicationByTrackingNumber('REG-X', { fetcher });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Network down');
    }
  });

  it('returns kind:"error" on malformed JSON', async () => {
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('bad json');
          },
        }) as unknown as Response,
    );
    const result = await getApplicationByTrackingNumber('REG-X', { fetcher });
    expect(result.kind).toBe('error');
  });
});

describe('normalizeTrackingResult', () => {
  it('defaults missing arrays to empty', () => {
    const data = normalizeTrackingResult(
      { status: 'pending', submittedAt: '2025-01-01T00:00:00Z' },
      'REG-DEFAULT',
    );
    expect(data.trackingNumber).toBe('REG-DEFAULT');
    expect(data.history).toEqual([]);
    expect(data.followUpActions).toEqual([]);
    expect(data.updatedAt).toBe('2025-01-01T00:00:00Z');
  });

  it('defaults updatedAt to submittedAt when only submittedAt is provided', () => {
    const data = normalizeTrackingResult(
      { status: 'pending', submittedAt: '2025-02-02T00:00:00Z' },
      'REG-DEFAULT',
    );
    expect(data.updatedAt).toBe('2025-02-02T00:00:00Z');
  });

  it('keeps the trackingNumber from the payload when present', () => {
    const data = normalizeTrackingResult(
      { trackingNumber: 'REG-AAA', status: 'approved' },
      'REG-FALLBACK',
    );
    expect(data.trackingNumber).toBe('REG-AAA');
  });
});

// =============================================================================
// School Finder client tests (Task 51.3 / Requirement 16.9)
// =============================================================================

import {
  buildSchoolFinderQueryString,
  searchSchools,
  SCHOOL_FINDER_API_PREFIX,
} from './registration';

describe('buildSchoolFinderQueryString', () => {
  it('returns an empty string when no filters are set', () => {
    expect(buildSchoolFinderQueryString({})).toBe('');
  });

  it('serialises geolocation only when all three fields are present', () => {
    expect(buildSchoolFinderQueryString({ latitude: 12.95 })).toBe('');
    expect(buildSchoolFinderQueryString({ latitude: 12.95, longitude: 77.59 })).toBe('');
    const qs = buildSchoolFinderQueryString({
      latitude: 12.95,
      longitude: 77.59,
      radiusKm: 5,
    });
    expect(qs).toContain('latitude=12.95');
    expect(qs).toContain('longitude=77.59');
    expect(qs).toContain('radiusKm=5');
  });

  it('joins multi-value lists with commas', () => {
    const qs = buildSchoolFinderQueryString({
      areaIds: ['n', 'e'],
      schoolTypes: ['primary'],
      gradeLevels: ['g1', 'g2', 'g3'],
    });
    expect(qs).toContain('areaIds=n%2Ce');
    expect(qs).toContain('schoolTypes=primary');
    expect(qs).toContain('gradeLevels=g1%2Cg2%2Cg3');
  });

  it('omits empty filter lists and empty search', () => {
    const qs = buildSchoolFinderQueryString({
      areaIds: [],
      search: '   ',
    });
    expect(qs).toBe('');
  });

  it('forwards page + pageSize when provided', () => {
    const qs = buildSchoolFinderQueryString({ page: 3, pageSize: 25 });
    expect(qs).toContain('page=3');
    expect(qs).toContain('pageSize=25');
  });
});

describe('searchSchools', () => {
  it('hits the schools/search endpoint with the encoded query string', async () => {
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            data: [],
            meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          }),
        }) as Response,
    );
    await searchSchools(
      { areaIds: ['a'], page: 1 },
      { fetcher: fetcher as unknown as typeof fetch },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    const call = fetcher.mock.calls[0]!;
    const [url] = call as unknown as [RequestInfo | URL];
    expect(String(url)).toContain(SCHOOL_FINDER_API_PREFIX);
    expect(String(url)).toContain('areaIds=a');
  });

  it('returns kind:"ok" with data and meta on 200', async () => {
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'a',
                name: 'Alpha',
                code: 'A-1',
                typeId: 't',
                areaId: 'r',
                latitude: 12.97,
                longitude: 77.59,
              },
            ],
            meta: {
              page: 1,
              pageSize: 20,
              totalItems: 1,
              totalPages: 1,
              origin: { latitude: 12.97, longitude: 77.59, radiusKm: 5 },
            },
          }),
        }) as Response,
    );
    const result = await searchSchools(
      { latitude: 12.97, longitude: 77.59, radiusKm: 5 },
      { fetcher: fetcher as unknown as typeof fetch },
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data).toHaveLength(1);
      expect(result.meta.origin).toEqual({
        latitude: 12.97,
        longitude: 77.59,
        radiusKm: 5,
      });
    }
  });

  it('returns kind:"error" on non-OK responses, surfacing the body message when present', async () => {
    const fetcher = vi.fn(
      async () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({ message: 'Invalid School Finder query' }),
        }) as Response,
    );
    const result = await searchSchools(
      { latitude: 12.97 },
      { fetcher: fetcher as unknown as typeof fetch },
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Invalid School Finder query');
    }
  });

  it('returns kind:"error" when fetch throws', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('Network down');
    });
    const result = await searchSchools({}, { fetcher: fetcher as unknown as typeof fetch });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Network down');
    }
  });
});
