/**
 * apps/web/src/features/registration/components/SchoolFinder.tsx —
 * Public School Finder embedded in the registration wizard
 * (Task 51.3, Requirements 16.4 / 16.9, Design §F).
 * =============================================================================
 *
 * Renders three regions:
 *
 *   1. **Geolocation prompt** — a button that asks the browser for the
 *      user's coordinates via `navigator.geolocation.getCurrentPosition`.
 *      The prompt is non-blocking: when permission is denied (or the API
 *      is unavailable, e.g. SSR / test environments) the manual filter
 *      form below is the fallback path.
 *
 *   2. **Manual filter form** — area, school type, grade level, name
 *      search, plus radius once a location is captured. Lists are
 *      derived from the props the parent passes in; there is no
 *      hard-coded option set.
 *
 *   3. **Results list** — paginated, keyboard-navigable, with an "Add to
 *      preferences" button per row. Distance is shown when the query
 *      carried a geolocation block. Pagination buttons + result count
 *      live below the list.
 *
 * Networking is delegated to `searchSchools()` in
 * `@/lib/api/registration`. The fetch can be overridden in tests via the
 * optional `fetcher` prop.
 *
 * The component is a controlled "selector": it reports add / remove
 * actions through `onAddPreference` and `onRemovePreference`, and reads
 * the current set of selected ids from `selectedIds` so the row's
 * "Added" state stays in sync with the parent's `<RankedPreference>`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import {
  searchSchools,
  type SchoolFinderQueryInput,
  type SchoolFinderResult,
} from '@/lib/api/registration';

/** Lightweight option model for the dropdown filters. */
export interface SchoolFinderOption {
  value: string;
  label: string;
}

export interface SchoolFinderProps {
  /** Selectable area hierarchy nodes. */
  areaOptions?: SchoolFinderOption[];
  /** Selectable institution types (primary / secondary / etc.). */
  schoolTypeOptions?: SchoolFinderOption[];
  /** Selectable grade levels. */
  gradeOptions?: SchoolFinderOption[];
  /** Currently selected schools (rendered as "Added" pills). */
  selectedIds: string[];
  /** Called when the user adds a school to their preferences. */
  onAddPreference: (school: SchoolFinderResult) => void;
  /** Called when the user removes a school directly from the results. */
  onRemovePreference?: (schoolId: string) => void;
  /** Maximum preferences the parent will accept. Used to disable Add. */
  maxPreferences?: number;
  /** Page size for the API. Defaults to 10 to keep results scannable. */
  pageSize?: number;
  /** Inject a fetch implementation for tests. */
  fetcher?: typeof fetch;
}

/** Default search radius (km) once geolocation is captured. */
const DEFAULT_RADIUS_KM = 10;
/** Min/max radius bounds shown on the slider. */
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 100;

interface GeoCoords {
  latitude: number;
  longitude: number;
}

/**
 * Wrap `navigator.geolocation.getCurrentPosition` in a promise so we can
 * await it. Resolves with `null` when the browser API is unavailable so
 * the caller can fall back to the manual form without a thrown error.
 */
function requestGeolocation(): Promise<GeoCoords | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/**
 * Public School Finder. See module docs for the contract.
 */
export function SchoolFinder({
  areaOptions = [],
  schoolTypeOptions = [],
  gradeOptions = [],
  selectedIds,
  onAddPreference,
  onRemovePreference,
  maxPreferences = 3,
  pageSize = 10,
  fetcher,
}: SchoolFinderProps): JSX.Element {
  // ─── Filter state ─────────────────────────────────────────────────────────
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [areaId, setAreaId] = useState<string>('');
  const [schoolType, setSchoolType] = useState<string>('');
  const [gradeLevel, setGradeLevel] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  // ─── Geolocation prompt state ─────────────────────────────────────────────
  const [geoStatus, setGeoStatus] = useState<
    'idle' | 'pending' | 'granted' | 'denied' | 'unavailable'
  >('idle');
  const [geoError, setGeoError] = useState<string>('');

  // ─── Results state ────────────────────────────────────────────────────────
  const [results, setResults] = useState<SchoolFinderResult[]>([]);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [hasSearched, setHasSearched] = useState<boolean>(false);

  // Cancel in-flight requests when filters change rapidly.
  const abortRef = useRef<AbortController | null>(null);

  // ─── Search action ───────────────────────────────────────────────────────
  const runSearch = useCallback(
    async (overridePage?: number) => {
      const targetPage = overridePage ?? page;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const query: SchoolFinderQueryInput = {
        page: targetPage,
        pageSize,
      };
      if (coords) {
        query.latitude = coords.latitude;
        query.longitude = coords.longitude;
        query.radiusKm = radiusKm;
      }
      if (areaId) query.areaIds = [areaId];
      if (schoolType) query.schoolTypes = [schoolType];
      if (gradeLevel) query.gradeLevels = [gradeLevel];
      if (search.trim().length > 0) query.search = search.trim();

      setLoading(true);
      setError('');
      const result = await searchSchools(query, {
        signal: ac.signal,
        ...(fetcher ? { fetcher } : {}),
      });
      // Bail out if the request was aborted by a fresher search.
      if (ac.signal.aborted) return;
      setLoading(false);
      setHasSearched(true);

      if (result.kind === 'error') {
        // Aborted requests surface as 'aborted' — ignore them.
        if (result.message === 'aborted') return;
        setError(result.message);
        return;
      }
      setResults(result.data);
      setTotalItems(result.meta.totalItems);
      setTotalPages(result.meta.totalPages);
    },
    [areaId, coords, fetcher, gradeLevel, page, pageSize, radiusKm, schoolType, search],
  );

  // Re-run the search when the page index changes (pagination).
  useEffect(() => {
    if (!hasSearched) return;
    void runSearch();
    // We intentionally only re-run on `page` here; the form submit
    // handler triggers fresh searches when filters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // ─── Geolocation prompt ──────────────────────────────────────────────────
  const handleUseMyLocation = useCallback(async () => {
    setGeoStatus('pending');
    setGeoError('');
    try {
      const position = await requestGeolocation();
      if (!position) {
        setGeoStatus('unavailable');
        return;
      }
      setCoords(position);
      setGeoStatus('granted');
    } catch (err) {
      const errCode = (err as GeolocationPositionError | undefined)?.code;
      if (errCode === 1 /* PERMISSION_DENIED */) {
        setGeoStatus('denied');
        setGeoError('Location permission denied. Use the filters below instead.');
      } else {
        setGeoStatus('unavailable');
        setGeoError('Could not determine your location. Use the filters below.');
      }
    }
  }, []);

  const handleClearLocation = useCallback(() => {
    setCoords(null);
    setGeoStatus('idle');
    setGeoError('');
  }, []);

  // ─── Form submit ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      // Reset to page 1 on filter change so users see the top of the
      // new result set.
      if (page !== 1) {
        setPage(1);
        await runSearch(1);
      } else {
        await runSearch(1);
      }
    },
    [page, runSearch],
  );

  // ─── Pagination ──────────────────────────────────────────────────────────
  const goPrevPage = useCallback(() => {
    setPage((p) => Math.max(1, p - 1));
  }, []);
  const goNextPage = useCallback(() => {
    setPage((p) => (p < totalPages ? p + 1 : p));
  }, [totalPages]);

  // ─── Results list keyboard navigation ────────────────────────────────────
  const listRef = useRef<HTMLUListElement>(null);
  const handleResultsKey = useCallback((e: KeyboardEvent<HTMLUListElement>) => {
    if (!listRef.current) return;
    const items = Array.from(listRef.current.querySelectorAll<HTMLLIElement>('[role="listitem"]'));
    const active = document.activeElement;
    const currentIdx = items.findIndex((el) => el.contains(active));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[Math.min(items.length - 1, currentIdx + 1)] ?? items[0];
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[Math.max(0, currentIdx - 1)] ?? items[0];
      prev?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }, []);

  const isMaxedOut = selectedIds.length >= maxPreferences;
  const idSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <section aria-label="School finder" className="space-y-4" data-testid="school-finder">
      {/* 1. Geolocation prompt */}
      <div className="rounded-md border bg-muted/50 p-3" data-testid="school-finder-geolocation">
        {coords ? (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Using your location</p>
              <p className="text-xs text-muted-foreground">
                Within {radiusKm} km of {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-sm hover:bg-background"
              onClick={handleClearLocation}
              data-testid="school-finder-clear-location"
            >
              Clear location
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Find schools near you</p>
              <p className="text-xs text-muted-foreground">
                We can sort results by distance once you allow location access.
              </p>
              {geoError ? (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  {geoError}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded-md border bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={handleUseMyLocation}
              disabled={geoStatus === 'pending'}
              data-testid="school-finder-use-location"
            >
              {geoStatus === 'pending' ? 'Locating…' : 'Use my location'}
            </button>
          </div>
        )}
      </div>

      {/* 2. Manual filter form */}
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        data-testid="school-finder-filters"
      >
        <div>
          <label htmlFor="school-finder-search" className="block text-xs font-medium">
            School name
          </label>
          <input
            id="school-finder-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border bg-background p-2"
            placeholder="Search by name"
            data-testid="school-finder-search"
          />
        </div>

        <div>
          <label htmlFor="school-finder-area" className="block text-xs font-medium">
            Area
          </label>
          <select
            id="school-finder-area"
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            className="w-full rounded-md border bg-background p-2"
            data-testid="school-finder-area"
          >
            <option value="">All areas</option>
            {areaOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="school-finder-type" className="block text-xs font-medium">
            Type
          </label>
          <select
            id="school-finder-type"
            value={schoolType}
            onChange={(e) => setSchoolType(e.target.value)}
            className="w-full rounded-md border bg-background p-2"
            data-testid="school-finder-type"
          >
            <option value="">All types</option>
            {schoolTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="school-finder-grade" className="block text-xs font-medium">
            Grade
          </label>
          <select
            id="school-finder-grade"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            className="w-full rounded-md border bg-background p-2"
            data-testid="school-finder-grade"
          >
            <option value="">Any grade</option>
            {gradeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {coords ? (
          <div className="sm:col-span-2">
            <label htmlFor="school-finder-radius" className="block text-xs font-medium">
              Radius: {radiusKm} km
            </label>
            <input
              id="school-finder-radius"
              type="range"
              min={MIN_RADIUS_KM}
              max={MAX_RADIUS_KM}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="w-full"
              data-testid="school-finder-radius"
            />
          </div>
        ) : null}

        <div className="sm:col-span-2 flex justify-end">
          <button
            type="submit"
            className="rounded-md border bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            disabled={loading}
            data-testid="school-finder-submit"
          >
            {loading ? 'Searching…' : 'Search schools'}
          </button>
        </div>
      </form>

      {/* 3. Results list */}
      <div data-testid="school-finder-results">
        {error ? (
          <p
            className="rounded-md border border-destructive p-3 text-sm text-destructive"
            role="alert"
            data-testid="school-finder-error"
          >
            {error}
          </p>
        ) : null}

        {hasSearched && !loading && results.length === 0 && !error ? (
          <p
            className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
            data-testid="school-finder-empty"
          >
            No schools matched those filters. Try widening your search.
          </p>
        ) : null}

        {results.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground" data-testid="school-finder-count">
              {totalItems} school{totalItems === 1 ? '' : 's'} found
              {totalPages > 1 ? ` — page ${page} of ${totalPages}` : ''}
            </p>
            <ul
              ref={listRef}
              role="list"
              aria-label="Search results"
              className="mt-2 space-y-2"
              onKeyDown={handleResultsKey}
              data-testid="school-finder-results-list"
            >
              {results.map((school) => {
                const alreadySelected = idSet.has(school.id);
                const canAdd = !alreadySelected && !isMaxedOut;
                return (
                  <li
                    key={school.id}
                    role="listitem"
                    tabIndex={0}
                    className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    data-testid={`school-finder-result-${school.id}`}
                  >
                    <div>
                      <p className="text-sm font-medium">{school.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {school.code}
                        {school.typeName ? ` • ${school.typeName}` : ''}
                        {school.areaName ? ` • ${school.areaName}` : ''}
                      </p>
                      {typeof school.distanceKm === 'number' ? (
                        <p
                          className="text-xs text-muted-foreground"
                          data-testid={`school-finder-distance-${school.id}`}
                        >
                          {school.distanceKm.toFixed(1)} km away
                        </p>
                      ) : null}
                      {school.address ? (
                        <p className="text-xs text-muted-foreground">{school.address}</p>
                      ) : null}
                    </div>
                    {alreadySelected ? (
                      <button
                        type="button"
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        onClick={() => onRemovePreference?.(school.id)}
                        data-testid={`school-finder-remove-${school.id}`}
                      >
                        Added
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-md border bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        onClick={() => onAddPreference(school)}
                        disabled={!canAdd}
                        data-testid={`school-finder-add-${school.id}`}
                      >
                        Add
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {totalPages > 1 ? (
              <div
                className="mt-3 flex items-center justify-between"
                data-testid="school-finder-pagination"
              >
                <button
                  type="button"
                  onClick={goPrevPage}
                  disabled={page === 1 || loading}
                  className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
                  data-testid="school-finder-prev"
                >
                  Previous
                </button>
                <span className="text-xs text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={goNextPage}
                  disabled={page >= totalPages || loading}
                  className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
                  data-testid="school-finder-next"
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

export default SchoolFinder;
