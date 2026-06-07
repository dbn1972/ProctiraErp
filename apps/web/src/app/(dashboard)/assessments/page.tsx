/**
 * /assessments — Grading scheme list (Server Component).
 *
 * Implements Requirement 8.1 (grading schemes per institution + period).
 */
import Link from 'next/link';
import { Plus } from 'lucide-react';

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
import { listGradingSchemes } from '@/lib/api/assessments';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function readStringParam(
  params: PageProps['searchParams'],
  key: string,
  defaultValue = '',
): string {
  if (!params) return defaultValue;
  const value = params[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? defaultValue;
  return defaultValue;
}

function readNumberParam(
  params: PageProps['searchParams'],
  key: string,
  defaultValue: number,
): number {
  const raw = readStringParam(params, key);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export default async function AssessmentsPage({ searchParams }: PageProps) {
  const search = readStringParam(searchParams, 'search');
  const type = readStringParam(searchParams, 'type');
  const page = readNumberParam(searchParams, 'page', 1);

  const response = await listGradingSchemes({
    search: search || undefined,
    type:
      type === 'numeric' || type === 'letter' || type === 'competency'
        ? type
        : undefined,
    page,
    pageSize: 25,
  });

  return (
    <section aria-labelledby="assessments-heading" className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1
            id="assessments-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Assessments
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Configure grading schemes, assessment items, and result entry.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/assessments/items">Assessment items</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/assessments/results">Result entry</Link>
          </Button>
          <Button asChild>
            <Link href="/assessments/schemes/new">
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              New scheme
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grading schemes</CardTitle>
          <CardDescription>
            {response.meta.totalItems.toLocaleString()} schemes configured for
            this tenant. Numeric, letter, and competency schemes supported.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {response.data.length === 0 ? (
            <EmptyState />
          ) : (
            <Table aria-label="Grading schemes">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead>Thresholds</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {response.data.map((scheme) => (
                  <TableRow key={scheme.id}>
                    <TableCell className="font-medium">{scheme.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{scheme.type}</Badge>
                    </TableCell>
                    <TableCell>
                      {scheme.minValue} – {scheme.maxValue}
                    </TableCell>
                    <TableCell>{scheme.thresholds.length}</TableCell>
                    <TableCell>
                      {new Date(scheme.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/assessments/schemes/${scheme.id}/edit`}>
                          Edit
                        </Link>
                      </Button>
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
      <p className="text-base font-medium">No grading schemes yet</p>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Create a scheme to start configuring assessments.
      </p>
      <Button asChild className="mt-2">
        <Link href="/assessments/schemes/new">Create grading scheme</Link>
      </Button>
    </div>
  );
}
