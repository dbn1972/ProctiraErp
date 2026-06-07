/**
 * DataPreview — table displaying query results with aggregation toggle.
 *
 * Shows data records from the data warehouse query in a tabular format.
 * Supports toggling between raw data and aggregated views (sum, avg, count).
 *
 * Task 60A.5 / Requirements 15.1, 15.4
 */

import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
} from '@proctira/ui/components';
import type { DataQueryResult, DataRecord } from '../api/data-warehouse-browser';

interface DataPreviewProps {
  /** Query result data */
  result: DataQueryResult | null;
  /** Whether data is loading */
  loading: boolean;
  /** Current aggregation mode */
  aggregation: 'none' | 'sum' | 'avg' | 'count';
  /** Callback when aggregation changes */
  onAggregationChange: (aggregation: 'none' | 'sum' | 'avg' | 'count') => void;
  /** Callback for pagination */
  onPageChange?: (page: number) => void;
}

export function DataPreview({
  result,
  loading,
  aggregation,
  onAggregationChange,
  onPageChange,
}: DataPreviewProps) {
  const totalPages = useMemo(() => {
    if (!result) return 0;
    return Math.ceil(result.total / result.pageSize);
  }, [result]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Data Preview</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Aggregation:</span>
          <Select
            value={aggregation}
            onValueChange={(v) => onAggregationChange(v as typeof aggregation)}
          >
            <SelectTrigger className="w-[120px]" aria-label="Aggregation mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="sum">Sum</SelectItem>
              <SelectItem value="avg">Average</SelectItem>
              <SelectItem value="count">Count</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !result || result.data.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No data to display. Configure your query filters and run the query.
          </p>
        ) : (
          <>
            {/* Aggregation summary */}
            {result.aggregation && (
              <div className="mb-4 p-3 bg-muted/50 rounded-md">
                <span className="text-sm font-medium">
                  {result.aggregation.type.toUpperCase()}:{' '}
                </span>
                <Badge variant="default" className="text-sm">
                  {result.aggregation.value.toLocaleString()}
                </Badge>
              </div>
            )}

            {/* Data table */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Indicator</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Subgroup</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Time Period</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.data.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">{record.indicatorName}</TableCell>
                      <TableCell>{record.unitName}</TableCell>
                      <TableCell>{record.subgroupName}</TableCell>
                      <TableCell>{record.areaName}</TableCell>
                      <TableCell>{record.timePeriod}</TableCell>
                      <TableCell className="text-right font-mono">
                        {record.value.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {record.source ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {result.page} of {totalPages} ({result.total} records)
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={result.page <= 1}
                    onClick={() => onPageChange?.(result.page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={result.page >= totalPages}
                    onClick={() => onPageChange?.(result.page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
