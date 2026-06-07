/**
 * DataQueryBuilder — data query builder with area/time filters.
 *
 * Combines the IndicatorBrowser selections with area and time period
 * filters to query the data warehouse and display results in the
 * DataPreview table. Supports export via DataExport.
 *
 * Task 60A.5 / Requirements 15.1, 15.3, 15.4, 15.5
 */

import { useCallback, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
} from '@proctira/ui/components';
import { AreaPicker } from '@proctira/ui/area-picker';
import type { AreaNode } from '@proctira/ui/area-picker';
import { TimePeriodSelector } from '../components/TimePeriodSelector';
import { DataPreview } from '../components/DataPreview';
import { DataExport } from '../components/DataExport';
import { GISLayerViewer } from '../components/GISLayerViewer';
import {
  queryData,
  type DataQueryParams,
  type DataQueryResult,
} from '../api/data-warehouse-browser';
import type { IndicatorSelection } from './IndicatorBrowser';

// Placeholder area tree — in production this would be fetched from the API
const PLACEHOLDER_AREAS: AreaNode[] = [];

interface DataQueryBuilderProps {
  /** Indicator selections from the IndicatorBrowser */
  indicatorSelections?: IndicatorSelection[];
}

export default function DataQueryBuilder({
  indicatorSelections = [],
}: DataQueryBuilderProps) {
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [selectedTimePeriodIds, setSelectedTimePeriodIds] = useState<string[]>([]);
  const [aggregation, setAggregation] = useState<'none' | 'sum' | 'avg' | 'count'>('none');
  const [result, setResult] = useState<DataQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [areas, setAreas] = useState<AreaNode[]>(PLACEHOLDER_AREAS);
  const [showMap, setShowMap] = useState(false);

  // Build query params from current selections
  const buildQueryParams = useCallback(
    (page: number = 1): DataQueryParams => {
      const indicatorIds = indicatorSelections.map((s) => s.indicatorId);
      const unitIds = indicatorSelections.flatMap((s) => s.unitIds);
      const subgroupIds = indicatorSelections.flatMap((s) => s.subgroupIds);

      return {
        indicatorIds: indicatorIds.length > 0 ? indicatorIds : undefined,
        unitIds: unitIds.length > 0 ? unitIds : undefined,
        subgroupIds: subgroupIds.length > 0 ? subgroupIds : undefined,
        areaIds: selectedAreaIds.length > 0 ? selectedAreaIds : undefined,
        timePeriodIds: selectedTimePeriodIds.length > 0 ? selectedTimePeriodIds : undefined,
        aggregation: aggregation !== 'none' ? aggregation : undefined,
        page,
        pageSize: 25,
      };
    },
    [indicatorSelections, selectedAreaIds, selectedTimePeriodIds, aggregation],
  );

  // Execute query
  const handleRunQuery = useCallback(async () => {
    setLoading(true);
    setCurrentPage(1);
    try {
      const params = buildQueryParams(1);
      const data = await queryData(params);
      setResult(data);
    } catch (err) {
      console.error('Failed to query data:', err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [buildQueryParams]);

  // Handle pagination
  const handlePageChange = useCallback(
    async (page: number) => {
      setLoading(true);
      setCurrentPage(page);
      try {
        const params = buildQueryParams(page);
        const data = await queryData(params);
        setResult(data);
      } catch (err) {
        console.error('Failed to load page:', err);
      } finally {
        setLoading(false);
      }
    },
    [buildQueryParams],
  );

  // Handle area selection
  const handleAreaSelect = useCallback((ids: string[]) => {
    setSelectedAreaIds(ids);
  }, []);

  const hasFilters =
    indicatorSelections.length > 0 ||
    selectedAreaIds.length > 0 ||
    selectedTimePeriodIds.length > 0;

  return (
    <div className="space-y-6">
      {/* Query filters */}
      <Card>
        <CardHeader>
          <CardTitle>Data Query Builder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Indicator summary */}
          <div>
            <label className="text-sm font-medium mb-1 block">Selected Indicators</label>
            {indicatorSelections.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {indicatorSelections.length} indicator{indicatorSelections.length !== 1 ? 's' : ''} selected
                {indicatorSelections.map((s) => s.indicatorName).join(', ')}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No indicators selected. Use the Indicator Browser tab to select indicators.
              </p>
            )}
          </div>

          <Separator />

          {/* Area filter */}
          <div>
            <label className="text-sm font-medium mb-1 block">Area Filter</label>
            <AreaPicker
              areas={areas}
              selectedIds={selectedAreaIds}
              onSelect={(ids) => handleAreaSelect(ids)}
              multiple
              searchable
              ariaLabel="Select areas for data query"
              placeholder="Select areas…"
            />
          </div>

          {/* Time period filter */}
          <div>
            <label className="text-sm font-medium mb-1 block">Time Period</label>
            <TimePeriodSelector
              selectedIds={selectedTimePeriodIds}
              onSelectionChange={setSelectedTimePeriodIds}
              placeholder="Select time periods…"
              ariaLabel="Select time periods for data query"
            />
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleRunQuery} disabled={loading || !hasFilters}>
              {loading ? 'Querying…' : 'Run Query'}
            </Button>
            <DataExport queryParams={buildQueryParams()} disabled={!result} />
            <Button
              variant="outline"
              onClick={() => setShowMap(!showMap)}
            >
              {showMap ? 'Hide Map' : 'Show Map'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* GIS Map Viewer */}
      {showMap && <GISLayerViewer />}

      {/* Data preview */}
      <DataPreview
        result={result}
        loading={loading}
        aggregation={aggregation}
        onAggregationChange={setAggregation}
        onPageChange={handlePageChange}
      />
    </div>
  );
}
