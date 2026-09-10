/**
 * <MapDrillDown /> — region map placeholder for click-to-drill dashboards.
 *
 * Design §G calls for a GeoJSON choropleth wired to the platform's
 * Area_Hierarchy (Country → State → District → School). The full
 * implementation is out of scope for the widget-library task; this
 * placeholder establishes the public API and layout slot so dashboards
 * can compose against it now and the cartography backend can be plugged
 * in by a follow-up task without breaking consumers.
 *
 * TODO: full implementation in 52.x — load GeoJSON via `topojson-client`,
 * render with `react-simple-maps` (or d3-geo), and wire `onRegionClick`
 * to the Area_Hierarchy router. Reference shape: each region carries
 * `{ id, name, value, parentId }`; the choropleth shades regions by
 * `value` against a 5-stop ramp pulled from `useChartPalette().series`.
 *
 * Until the implementation lands, the placeholder:
 *   - Renders a labelled card with `role="region"` so screen readers
 *     announce the section (Design L).
 *   - Lists the supplied regions in a fallback list so dashboards still
 *     expose drill-down affordances on assistive tech.
 *   - Honors the standard widget contract (loading / empty / error).
 */

import { Map as MapIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@proctira/ui-components';

import { cn } from './lib/utils';
import { useAsyncAnnounce } from './lib/useAsyncAnnounce';

export interface MapRegion {
  /** Stable region identifier (e.g. ISO state code, area_id). */
  id: string;
  /** Human-readable region label. */
  name: string;
  /**
   * Metric value driving the choropleth shade. Keep in the same unit
   * across the map (e.g. enrollment count, attendance %).
   */
  value: number;
}

export interface MapDrillDownProps {
  /** Card title (e.g. `"Enrollment by state"`). */
  title: string;
  /** Optional secondary description. */
  description?: ReactNode;
  /** Region data points. */
  regions: ReadonlyArray<MapRegion>;
  /** Click-to-drill handler. */
  onRegionClick?: (region: MapRegion) => void;
  /** Whether the map is loading. */
  loading?: boolean;
  /** Error from the data fetch. */
  error?: unknown;
  /** Empty-state message. */
  emptyMessage?: ReactNode;
  /** Override for the SR announcement on loading→loaded. */
  loadedMessage?: string;
  /** Optional class applied to the outer `<Card>`. */
  className?: string;
  /** Optional `data-testid`. */
  'data-testid'?: string;
}

export function MapDrillDown({
  title,
  description,
  regions,
  onRegionClick,
  loading = false,
  error,
  emptyMessage = 'No regions to display',
  loadedMessage,
  className,
  'data-testid': dataTestId,
}: MapDrillDownProps) {
  useAsyncAnnounce({
    loading,
    loadedMessage: loadedMessage ?? `${title} map loaded`,
    error,
  });

  return (
    <Card
      className={cn('overflow-hidden', className)}
      data-testid={dataTestId}
      data-state={loading ? 'loading' : error ? 'error' : 'ready'}
      aria-busy={loading ? 'true' : undefined}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-0">
        {error ? (
          <p
            role="alert"
            className="text-sm text-[hsl(var(--destructive))]"
            data-testid="map-drill-down-error"
          >
            Unable to load the regional map.
          </p>
        ) : loading ? (
          <Skeleton className="h-64 w-full rounded-md" data-testid="map-drill-down-skeleton" />
        ) : regions.length === 0 ? (
          <p
            className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]"
            data-testid="map-drill-down-empty"
          >
            {emptyMessage}
          </p>
        ) : (
          <div
            role="region"
            aria-label={`${title} — placeholder map. Region list available below.`}
            data-testid="map-drill-down-region"
            className="rounded-md border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-4"
          >
            <p className="mb-3 text-sm text-[hsl(var(--muted-foreground))]">
              Map placeholder — full GeoJSON choropleth ships in a follow-up task. The drill-down
              list below remains the source of truth for assistive-tech users.
            </p>
            <ul
              className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3"
              data-testid="map-drill-down-list"
            >
              {regions.map((region) => {
                const interactive = Boolean(onRegionClick);
                const content = (
                  <span className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{region.name}</span>
                    <span className="text-[hsl(var(--muted-foreground))]">{region.value}</span>
                  </span>
                );
                return (
                  <li key={region.id}>
                    {interactive ? (
                      <button
                        type="button"
                        onClick={() => onRegionClick?.(region)}
                        className="w-full rounded-md px-2 py-1 text-start hover:bg-[hsl(var(--accent))]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--ring))]"
                        data-testid={`map-drill-down-region-${region.id}`}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className="px-2 py-1">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

MapDrillDown.displayName = 'MapDrillDown';
