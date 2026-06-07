/**
 * Data warehouse indicators list (Server Component).
 *
 * Validates: Requirement 15.1 — indicator browse with category and trend.
 */
import Link from 'next/link';
import { ArrowDown, ArrowRight, ArrowUp, BarChart3 } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { listIndicators, type DwIndicator } from '@/lib/api/data-warehouse';

export const dynamic = 'force-dynamic';

export default async function DataWarehousePage() {
  const indicators = await listIndicators();

  return (
    <section aria-labelledby="dw-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="dw-heading" className="text-2xl font-semibold tracking-tight">
            Data warehouse
          </h1>
          <p className="text-sm text-muted-foreground">
            Track indicators across enrolment, attendance, performance, and resources.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/data-warehouse/import">Import data</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/data-warehouse/map">Open map viewer</Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Indicators</CardTitle>
          <CardDescription>
            {indicators.length.toLocaleString()} indicators tracked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {indicators.length === 0 ? (
            <EmptyState />
          ) : (
            <IndicatorsTable items={indicators} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
      <BarChart3 className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">No indicators yet</p>
      <p className="text-sm text-muted-foreground">
        Import operational data to populate indicators.
      </p>
      <Button asChild className="mt-2">
        <Link href="/data-warehouse/import">Import data</Link>
      </Button>
    </div>
  );
}

function IndicatorsTable({ items }: { items: DwIndicator[] }) {
  return (
    <Table aria-label="Indicators">
      <TableHeader>
        <TableRow>
          <TableHead>Indicator</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Unit</TableHead>
          <TableHead className="text-right">Latest value</TableHead>
          <TableHead>Trend</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((indicator) => (
          <TableRow key={indicator.id}>
            <TableCell>
              <p className="font-medium">{indicator.name}</p>
              <code className="text-xs text-muted-foreground">{indicator.code}</code>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{indicator.category}</Badge>
            </TableCell>
            <TableCell>{indicator.unit}</TableCell>
            <TableCell className="text-right">
              {indicator.latestValue !== null ? indicator.latestValue.toLocaleString() : '—'}
            </TableCell>
            <TableCell>
              <TrendBadge trend={indicator.trend} />
            </TableCell>
            <TableCell>{indicator.lastUpdated ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TrendBadge({ trend }: { trend: DwIndicator['trend'] }) {
  if (trend === 'UP') {
    return (
      <Badge variant="success" className="gap-1">
        <ArrowUp className="h-3 w-3" aria-hidden="true" /> Up
      </Badge>
    );
  }
  if (trend === 'DOWN') {
    return (
      <Badge variant="destructive" className="gap-1">
        <ArrowDown className="h-3 w-3" aria-hidden="true" /> Down
      </Badge>
    );
  }
  if (trend === 'FLAT') {
    return (
      <Badge variant="secondary" className="gap-1">
        <ArrowRight className="h-3 w-3" aria-hidden="true" /> Flat
      </Badge>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}
