/**
 * Institution list page (Server Component) — v2.0 redesign.
 *
 * Reads `search`, `areaId`, `status`, and `page` query parameters and asks
 * the institution service for a paginated slice via the server-side fetch
 * client. Filter controls and pagination buttons mutate the URL, which
 * re-renders this component on the server.
 *
 * Validates: Requirements 5.1 (institution CRUD), 5.3 (validation cues).
 *
 * v2.0 changes:
 * - text-3xl font-extrabold heading + count subtitle
 * - "Export UDISE" outline + "Register institution" primary in page-head
 * - 4-cell KPI grid (Schools, Blocks, area names, from API data)
 * - Inline filter bar (no Card wrapper)
 * - Table: school cell (icon + name + UDISE code mono), Block, Type tag,
 *   Students (dash if not in type), Staff, Attendance bar, Status pill,
 *   icon-button actions (Eye/Pencil/MoreVertical)
 */
import Link from 'next/link';
import {
  Building2,
  CheckCircle2,
  Download,
  Eye,
  GraduationCap,
  Map,
  MoreVertical,
  Pencil,
  Plus,
  School,
} from 'lucide-react';

import {
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
import { cn } from '@/lib/utils';
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
  value: string | string[] | undefined,
): InstitutionListFilters['status'] | undefined {
  const raw = singleParam(value);
  if (raw === 'ACTIVE' || raw === 'INACTIVE') return raw;
  return undefined;
}

/* ──────────────────────────────────────── KPI card ── */

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
}

function KpiCard({ icon: Icon, iconBg, label, value, foot }: KpiCardProps) {
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
        <p className="text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        {foot && <p className="mt-1 text-xs text-muted-foreground">{foot}</p>}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────── Attendance bar ── */

function AttendanceBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-sm text-muted-foreground">—</span>;
  const cls = pct >= 90 ? 'bg-emerald-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500';
  const textCls =
    pct >= 90
      ? 'text-emerald-700 dark:text-emerald-400'
      : pct >= 80
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-red-700 dark:text-red-400';

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', cls)}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Attendance: ${pct}%`}
        />
      </div>
      <span className={cn('text-xs font-semibold tabular-nums', textCls)}>{pct}%</span>
    </div>
  );
}

/* ──────────────────────────────────────── Status pill ── */

const SCHOOL_AVATAR_PALETTES = [
  'bg-blue-50   text-blue-600   dark:bg-blue-900   dark:text-blue-400',
  'bg-teal-50   text-teal-600   dark:bg-teal-900   dark:text-teal-400',
  'bg-amber-50  text-amber-600  dark:bg-amber-900  dark:text-amber-400',
  'bg-violet-50 text-violet-600 dark:bg-violet-900 dark:text-violet-400',
  'bg-sky-50    text-sky-600    dark:bg-sky-900    dark:text-sky-400',
] as const;

function schoolAvatar(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return (
    SCHOOL_AVATAR_PALETTES[Math.abs(hash) % SCHOOL_AVATAR_PALETTES.length] ??
    SCHOOL_AVATAR_PALETTES[0]
  );
}

const INST_STATUS_PILL: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  INACTIVE: 'bg-zinc-100   text-zinc-600    dark:bg-zinc-800       dark:text-zinc-400',
};

const INST_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

function InstitutionStatusPill({ status }: { status: string }) {
  const cls = INST_STATUS_PILL[status] ?? 'bg-zinc-100 text-zinc-600';
  const label = INST_STATUS_LABEL[status] ?? status;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        cls,
      )}
    >
      {label}
    </span>
  );
}

/* ──────────────────────────────────────── Institution row ── */

function InstitutionRow({ institution, areaName }: { institution: Institution; areaName: string }) {
  const palette = schoolAvatar(institution.name);
  // customData is not in the Institution type — use graceful fallbacks
  const cd = (institution as unknown as { customData?: Record<string, unknown> }).customData ?? {};
  const typeName = typeof cd['typeName'] === 'string' ? cd['typeName'] : '';
  const studentCount = typeof cd['studentCount'] === 'number' ? cd['studentCount'] : null;
  const staffCount = typeof cd['staffCount'] === 'number' ? cd['staffCount'] : null;
  const attendance = typeof cd['attendance'] === 'number' ? cd['attendance'] : null;

  return (
    <TableRow className="group">
      {/* School (person-cell) */}
      <TableCell>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', palette)}
          >
            <School className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Link
              href={`/institutions/${institution.id}/overview`}
              className="font-semibold text-foreground hover:underline"
            >
              {institution.name}
            </Link>
            <p className="font-mono text-[11px] text-muted-foreground">{institution.code}</p>
          </div>
        </div>
      </TableCell>

      {/* Block */}
      <TableCell className="text-sm text-muted-foreground">{areaName || '—'}</TableCell>

      {/* Type */}
      <TableCell>
        {typeName ? (
          <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
            {typeName}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Students */}
      <TableCell className="text-end text-sm tabular-nums text-foreground">
        {studentCount !== null ? studentCount.toLocaleString() : '—'}
      </TableCell>

      {/* Staff */}
      <TableCell className="text-end text-sm tabular-nums text-foreground">
        {staffCount !== null ? staffCount.toLocaleString() : '—'}
      </TableCell>

      {/* Attendance */}
      <TableCell>
        <AttendanceBar pct={attendance} />
      </TableCell>

      {/* Status */}
      <TableCell>
        <InstitutionStatusPill status={institution.status} />
      </TableCell>

      {/* Actions */}
      <TableCell className="text-end">
        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
            <Link
              href={`/institutions/${institution.id}/overview`}
              aria-label={`View ${institution.name}`}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
            <Link
              href={`/institutions/${institution.id}/edit`}
              aria-label={`Edit ${institution.name}`}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="More actions">
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ──────────────────────────────────────── Page ── */

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

  // Build a fast area id→name lookup
  const areaById: Record<string, string> = Object.fromEntries(areas.map((a) => [a.id, a.name]));
  const totalItems = listResult.data.meta.totalItems;
  const areaCount = areas.length;

  return (
    <section aria-labelledby="institutions-heading" className="space-y-6">
      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="institutions-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Institutions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalItems.toLocaleString()} schools · profiles, classes, and infrastructure
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm">
            <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
            Export UDISE
          </Button>
          <Button asChild size="sm">
            <Link href="/institutions/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              Register institution
            </Link>
          </Button>
        </div>
      </div>

      {/* ── KPI grid ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Building2}
          iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Schools"
          value={totalItems.toLocaleString()}
          foot="across all blocks"
        />
        <KpiCard
          icon={Map}
          iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
          label="Blocks / Areas"
          value={areaCount.toLocaleString()}
          foot={
            areaCount > 0
              ? areas
                  .slice(0, 3)
                  .map((a) => a.name)
                  .join(' · ') + (areaCount > 3 ? ' …' : '')
              : '—'
          }
        />
        <KpiCard
          icon={GraduationCap}
          iconBg="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          label="Students enrolled"
          value="—"
          foot="Connect enrollment API for live data"
        />
        <KpiCard
          icon={CheckCircle2}
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Reporting today"
          value="—"
          foot="Connect reporting API for live data"
        />
      </div>

      {/* ── Filter bar ── */}
      <InstitutionsFilters
        areas={areas}
        defaultSearch={search}
        defaultAreaId={areaId}
        defaultStatus={status}
      />

      {/* ── Table card ── */}
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
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {listResult.data.data.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <Building2 className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
                <p className="text-base font-semibold">No institutions found</p>
                <p className="text-sm text-muted-foreground">
                  Try adjusting your filters or register a new institution.
                </p>
                <Button asChild size="sm" className="mt-2">
                  <Link href="/institutions/new">
                    <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
                    Register institution
                  </Link>
                </Button>
              </div>
            ) : (
              <>
                <Table aria-label="Institutions">
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="font-semibold">School</TableHead>
                      <TableHead className="font-semibold">Block</TableHead>
                      <TableHead className="font-semibold">Type</TableHead>
                      <TableHead className="text-end font-semibold">Students</TableHead>
                      <TableHead className="text-end font-semibold">Staff</TableHead>
                      <TableHead className="font-semibold">Attendance</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="text-end font-semibold">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listResult.data.data.map((institution) => (
                      <InstitutionRow
                        key={institution.id}
                        institution={institution}
                        areaName={areaById[institution.areaId] ?? ''}
                      />
                    ))}
                  </TableBody>
                </Table>
                <div className="border-t px-4 py-3">
                  <PaginationControls
                    page={listResult.data.meta.page}
                    pageSize={listResult.data.meta.pageSize}
                    totalItems={listResult.data.meta.totalItems}
                    totalPages={listResult.data.meta.totalPages}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/* ──────────────────────────────────────── fetch helper (unchanged) ── */

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
