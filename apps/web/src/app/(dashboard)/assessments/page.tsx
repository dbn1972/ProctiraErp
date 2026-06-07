/**
 * /assessments — Grading scheme list (Server Component) — v2.0 redesign.
 *
 * Implements Requirement 8.1 (grading schemes per institution + period).
 */
import Link from 'next/link';
import { Eye, ListChecks, MoreVertical, Pencil, Plus } from 'lucide-react';

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
import { listGradingSchemes } from '@/lib/api/assessments';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function readStr(params: PageProps['searchParams'], key: string, fallback = ''): string {
  if (!params) return fallback;
  const v = params[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0] ?? fallback;
  return fallback;
}

function readNum(params: PageProps['searchParams'], key: string, fallback: number): number {
  const parsed = Number.parseInt(readStr(params, key), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const TYPE_PILL: Record<string, string> = {
  numeric:    'bg-blue-50   text-blue-700   dark:bg-blue-950/40   dark:text-blue-400',
  letter:     'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400',
  competency: 'bg-teal-50   text-teal-700   dark:bg-teal-950/40   dark:text-teal-400',
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export default async function AssessmentsPage({ searchParams }: PageProps) {
  const search = readStr(searchParams, 'search');
  const type = readStr(searchParams, 'type');
  const page = readNum(searchParams, 'page', 1);

  const response = await listGradingSchemes({
    search: search || undefined,
    type:
      type === 'numeric' || type === 'letter' || type === 'competency' ? type : undefined,
    page,
    pageSize: 25,
  });

  const total = response.meta.totalItems;

  return (
    <section aria-labelledby="assessments-heading" className="space-y-6">

      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="assessments-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Assessment schemes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} grading {total === 1 ? 'scheme' : 'schemes'} ·
            numeric, letter, and competency scales supported
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/assessments/items">
              <ListChecks className="me-1.5 h-4 w-4" aria-hidden="true" />
              Assessment items
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/assessments/results">Enter results</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/assessments/schemes/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              New scheme
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Table card ── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {response.data.length === 0 ? (
            <EmptyState />
          ) : (
            <Table aria-label="Grading schemes">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Scheme</TableHead>
                  <TableHead className="font-semibold">Type</TableHead>
                  <TableHead className="font-semibold">Range</TableHead>
                  <TableHead className="text-end font-semibold">Bands</TableHead>
                  <TableHead className="font-semibold">Updated</TableHead>
                  <TableHead className="text-end font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {response.data.map((scheme) => (
                  <TableRow key={scheme.id} className="group">
                    <TableCell>
                      <Link
                        href={`/assessments/schemes/${scheme.id}/edit`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {scheme.name}
                      </Link>
                      <p className="text-[11px] text-muted-foreground">
                        {scheme.thresholds.length} grade {scheme.thresholds.length === 1 ? 'band' : 'bands'} ·
                        {' '}{titleCase(scheme.type)} scale
                      </p>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          TYPE_PILL[scheme.type] ?? 'bg-zinc-100 text-zinc-600',
                        )}
                      >
                        {titleCase(scheme.type)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                      {scheme.minValue} – {scheme.maxValue}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums text-foreground">
                      {scheme.thresholds.length}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(scheme.updatedAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <Link href="/assessments/items" aria-label={`View items for ${scheme.name}`}>
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <Link href={`/assessments/schemes/${scheme.id}/edit`} aria-label={`Edit ${scheme.name}`}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="More actions">
                          <MoreVertical className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-base font-semibold">No grading schemes yet</p>
      <p className="text-sm text-muted-foreground">
        Create a scheme to start configuring assessments.
      </p>
      <Button asChild size="sm" className="mt-2">
        <Link href="/assessments/schemes/new">
          <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
          Create grading scheme
        </Link>
      </Button>
    </div>
  );
}
