/**
 * Data warehouse indicators list (Server Component) — v2.0 redesign.
 *
 * Validates: Requirement 15.1 — indicator browse with category and trend.
 *
 * v2.0 changes:
 * - text-3xl font-extrabold page head with subtitle + Import/Map actions
 * - KPI grid (Indicators tracked, plus "Currently unavailable" placeholders
 *   for metrics the page does not fetch)
 * - Table restyled per house conventions (muted header, group rows,
 *   font-mono codes, tabular-nums numeric, status/trend pills)
 *
 * Data fetching, aria labels, and test-relevant structure are unchanged.
 */
import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Database,
  Download,
  Map as MapIcon,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { listIndicators, type DwIndicator } from '@/lib/api/data-warehouse';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';
import { EmptyState } from '@/components/page';

export const dynamic = 'force-dynamic';

export default async function DataWarehousePage() {
  const { indicators, source } = await listIndicators();

  return (
    <section aria-labelledby="dw-heading" className="space-y-6">
      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 id="dw-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
            Data warehouse
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track indicators across enrolment, attendance, performance, and resources.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/pipelines">ETL pipelines</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/data-warehouse/map">
              <MapIcon className="me-1.5 h-4 w-4" aria-hidden="true" />
              Open GIS map
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/data-warehouse/field-mapping">Field mapping</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/data-warehouse/import">
              <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
              Import data
            </Link>
          </Button>
        </div>
      </div>

      <ScaffoldModeBanner
        source={source}
        surface="Data warehouse"
        detail={
          indicators.length === 0
            ? 'Indicator list is empty because the warehouse gateway is offline or unseeded — not because metrics were hidden.'
            : 'Indicator values reflect the warehouse gateway when connected.'
        }
      />

      {/* ── KPI grid ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={BarChart3}
          iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Indicators tracked"
          value={indicators.length.toLocaleString()}
          foot="across all categories"
        />
        <KpiCard
          icon={Database}
          iconBg="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          label="Records synced"
          value="Currently unavailable"
          valueMuted
          foot="Connect sync metrics API for live data"
        />
        <KpiCard
          icon={TrendingUp}
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Pipelines healthy"
          value="Currently unavailable"
          valueMuted
          foot="Connect pipeline status API for live data"
        />
        <KpiCard
          icon={RefreshCw}
          iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
          label="Last sync"
          value="Currently unavailable"
          valueMuted
          foot="Connect sync metrics API for live data"
        />
      </div>

      {/* ── Indicators table ── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {indicators.length === 0 ? (
            <EmptyState
              title="No indicators yet"
              description="Import operational data to populate indicators."
              action={
                <Button asChild size="sm">
                  <Link href="/data-warehouse/import">
                    <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
                    Import data
                  </Link>
                </Button>
              }
            />
          ) : (
            <IndicatorsTable items={indicators} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/* ──────────────────────────────────────── KPI card ── */

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  label: string;
  value: React.ReactNode;
  valueMuted?: boolean;
  foot?: React.ReactNode;
}

function KpiCard({ icon: Icon, iconBg, label, value, valueMuted, foot }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <span
            aria-hidden="true"
            className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconBg)}
          >
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <p
          className={cn(
            'font-extrabold tabular-nums tracking-tight',
            valueMuted ? 'text-base text-muted-foreground' : 'text-3xl text-foreground',
          )}
        >
          {value}
        </p>
        {foot && <p className="mt-1 text-xs text-muted-foreground">{foot}</p>}
      </CardContent>
    </Card>
  );
}

function IndicatorsTable({ items }: { items: DwIndicator[] }) {
  return (
    <Table aria-label="Indicators">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="font-semibold">Indicator</TableHead>
          <TableHead className="font-semibold">Category</TableHead>
          <TableHead className="font-semibold">Unit</TableHead>
          <TableHead className="text-end font-semibold">Latest value</TableHead>
          <TableHead className="font-semibold">Trend</TableHead>
          <TableHead className="font-semibold">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((indicator) => (
          <TableRow key={indicator.id} className="group">
            <TableCell>
              <p className="font-semibold text-foreground">{indicator.name}</p>
              <code className="font-mono text-[11px] text-muted-foreground">{indicator.code}</code>
            </TableCell>
            <TableCell>
              <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                {indicator.category}
              </span>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{indicator.unit}</TableCell>
            <TableCell className="text-end text-sm tabular-nums text-foreground">
              {indicator.latestValue !== null ? indicator.latestValue.toLocaleString() : '—'}
            </TableCell>
            <TableCell>
              <TrendBadge trend={indicator.trend} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {indicator.lastUpdated ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TrendBadge({ trend }: { trend: DwIndicator['trend'] }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';
  if (trend === 'UP') {
    return (
      <span
        className={cn(
          base,
          'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
        )}
      >
        <ArrowUp className="h-3 w-3" aria-hidden="true" /> Up
      </span>
    );
  }
  if (trend === 'DOWN') {
    return (
      <span className={cn(base, 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400')}>
        <ArrowDown className="h-3 w-3" aria-hidden="true" /> Down
      </span>
    );
  }
  if (trend === 'FLAT') {
    return (
      <span className={cn(base, 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400')}>
        <ArrowRight className="h-3 w-3" aria-hidden="true" /> Flat
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}
