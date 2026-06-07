/**
 * Institution list page (Server Component).
 *
 * Reads `search`, `areaId`, `status`, and `page` query parameters and asks
 * the institution service for a paginated slice via the server-side fetch
 * client. Filter controls and pagination buttons mutate the URL, which
 * re-renders this component on the server.
 *
 * Validates: Requirements 5.1 (institution CRUD), 5.3 (validation cues).
 */
import Link from 'next/link';
import { Building2, MapPin, Plus } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { InstitutionsFilters } from '@/components/institutions/institutions-filters';
import { PaginationControls } from '@/components/institutions/pagination-controls';
import { ApiClientError, listInstitutions } from '@/lib/institutions/api';
import { loadAreaOptions } from '@/lib/institutions/lookups';
import type {
  Institution,
  InstitutionListFilters,
  PaginatedResponse,
} from '@/lib/institutions/types';

interface InstitutionsPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

const DEFAULT_PAGE_SIZE = 20;

function singleParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parsePage(value: string | string[] | undefined): number {
  const raw = singleParam(value);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function parseStatus(
  value: string | string[] | undefined
): InstitutionListFilters['status'] | undefined {
  const raw = singleParam(value);
  if (raw === 'ACTIVE' || raw === 'INACTIVE') return raw;
  return undefined;
}

export default async function InstitutionsListPage({ searchParams }: InstitutionsPageProps) {
  const search = singleParam(searchParams.search) ?? '';
  const areaId = singleParam(searchParams.areaId) || undefined;
  const status = parseStatus(searchParams.status);
  const page = parsePage(searchParams.page);
  const pageSize = DEFAULT_PAGE_SIZE;

  const [areas, listResult] = await Promise.all([
    loadAreaOptions(),
    fetchInstitutions({ search, areaId, status, page, pageSize }),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Institutions</h1>
          <p className="text-sm text-muted-foreground">
            Browse, search, and manage education institutions.
          </p>
        </div>
        <Button asChild>
          <Link href="/institutions/new">
            <Plus className="h-4 w-4" /> New institution
          </Link>
        </Button>
      </header>

      <InstitutionsFilters
        areas={areas}
        defaultSearch={search}
        defaultAreaId={areaId}
        defaultStatus={status}
      />

      {listResult.error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Unable to load institutions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{listResult.error}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-semibold">
                {listResult.data.meta.totalItems} institutions
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Sorted by name (A → Z)
              </p>
            </CardHeader>
            <CardContent className="px-0">
              <InstitutionsTable institutions={listResult.data.data} />
            </CardContent>
          </Card>

          <PaginationControls
            page={listResult.data.meta.page}
            pageSize={listResult.data.meta.pageSize}
            totalItems={listResult.data.meta.totalItems}
            totalPages={listResult.data.meta.totalPages}
          />
        </>
      )}
    </div>
  );
}

function InstitutionsTable({ institutions }: { institutions: Institution[] }) {
  if (institutions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <Building2 className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-lg font-semibold">No institutions found</h2>
        <p className="text-sm text-muted-foreground">
          Try adjusting your filters or create a new institution.
        </p>
      </div>
    );
  }

  return (
    <Table aria-label="Institutions">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Address</TableHead>
          <TableHead className="w-32 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {institutions.map((institution) => (
          <TableRow key={institution.id}>
            <TableCell className="font-medium">
              <Link
                href={`/institutions/${institution.id}/overview`}
                className="text-primary hover:underline"
              >
                {institution.name}
              </Link>
            </TableCell>
            <TableCell>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {institution.code}
              </code>
            </TableCell>
            <TableCell>
              <Badge
                variant={institution.status === 'ACTIVE' ? 'success' : 'secondary'}
              >
                {institution.status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {institution.address ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {institution.address}
                </span>
              ) : (
                <span className="text-muted-foreground/60">—</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/institutions/${institution.id}/overview`}>View</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface ListResult {
  data: PaginatedResponse<Institution>;
  error: string | null;
}

async function fetchInstitutions(filters: InstitutionListFilters): Promise<ListResult> {
  try {
    const data = await listInstitutions(filters);
    return { data, error: null };
  } catch (error) {
    const message =
      error instanceof ApiClientError
        ? error.message
        : 'The institution service is currently unavailable.';
    return {
      data: {
        data: [],
        meta: {
          page: filters.page ?? 1,
          pageSize: filters.pageSize ?? DEFAULT_PAGE_SIZE,
          totalItems: 0,
          totalPages: 0,
        },
      },
      error: message,
    };
  }
}
