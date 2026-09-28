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
 *   icon-button actions (Eye/Pencil)
 */
import Link from 'next/link';
import { Building2, CheckCircle2, GraduationCap, Map as MapIcon, Plus } from 'lucide-react';

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
import { InstitutionRowActions } from '@/components/institutions/institution-row-actions';
import { InstitutionsFilters } from '@/components/institutions/institutions-filters';
import { PaginationControls } from '@/components/institutions/pagination-controls';
import { ApiClientError, listInstitutions } from '@/lib/institutions/api';
import { loadInstitutionDirectory } from '@/lib/institutions/directory';
import {
  INSTITUTION_LIST_ERROR,
  attendanceTone,
  directoryAttendanceBand,
  institutionListSubtitle,
  rowMetrics,
  type DirectorySchoolMetrics,
} from '@/lib/institutions/directory-presentation';
import { loadAreaOptions, loadTypeOptions, resolveLookupLabel } from '@/lib/institutions/lookups';
import type {
  Institution,
  InstitutionListFilters,
  PaginatedResponse,
} from '@/lib/institutions/types';

interface InstitutionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
        <div className="mb-3 flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconBg)}
          >
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
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
  const tone = attendanceTone(pct);
  const band = directoryAttendanceBand(pct);
  const cls =
    tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-red-500';
  const textCls =
    tone === 'green'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'amber'
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
          aria-label={`Attendance ${band}, ${pct}%`}
        />
      </div>
      <span className={cn('text-xs font-semibold', textCls)}>
        <span className="tabular-nums">{pct}%</span>
        <span className="ms-1 font-medium">{band}</span>
      </span>
    </div>
  );
}

/* ──────────────────────────────────────── Status pill ── */

const TYPE_CHIP =
  'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground';

/** Solid school glyph coloured by type. Senior Secondary stays blue for every campus. */
function schoolMarkClass(typeName: string): string {
  const key = typeName.trim().toLowerCase();
  if (key.includes('pre-primary') || key.includes('pre primary')) {
    return 'bg-gradient-to-br from-pink-500 to-pink-700';
  }
  if (key.includes('senior')) return 'bg-gradient-to-br from-[#3568CF] to-[#163780]';
  if (key.includes('secondary')) return 'bg-gradient-to-br from-teal-500 to-teal-700';
  if (key.includes('primary')) return 'bg-gradient-to-br from-amber-500 to-amber-700';
  return 'bg-gradient-to-br from-[#3568CF] to-[#163780]';
}

function SchoolMark({ typeName }: { typeName: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-white',
        schoolMarkClass(typeName),
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m4 6 8-4 8 4" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 22v-4a2 2 0 0 0-4 0v4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 5v17M6 5v17" />
        <circle cx="12" cy="9" r="2" />
      </svg>
    </span>
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
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        cls,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-zinc-400',
        )}
      />
      {label}
    </span>
  );
}

function InstitutionMobileCard({
  institution,
  areaName,
  typeName,
  metrics,
  metricsAvailable,
}: {
  institution: Institution;
  areaName: string;
  typeName: string;
  metrics: DirectorySchoolMetrics | undefined;
  metricsAvailable: { students: boolean; staff: boolean };
}) {
  const counts = rowMetrics(institution.status, metrics, metricsAvailable);
  return (
    <article className="space-y-3">
      <div className="flex items-start gap-3">
        <SchoolMark typeName={typeName} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/institutions/${institution.id}/overview`}
            className="font-semibold text-foreground hover:underline"
          >
            {institution.name}
          </Link>
          <p className="font-mono text-[11px] text-muted-foreground">{institution.code}</p>
        </div>
        <InstitutionStatusPill status={institution.status} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-[11px] font-semibold uppercase text-muted-foreground">Block</dt>
          <dd>{areaName || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase text-muted-foreground">Type</dt>
          <dd>{typeName ? <span className={TYPE_CHIP}>{typeName}</span> : '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase text-muted-foreground">Students</dt>
          <dd>{counts.students !== null ? counts.students.toLocaleString('en-IN') : '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase text-muted-foreground">Staff</dt>
          <dd>{counts.staff !== null ? counts.staff.toLocaleString('en-IN') : '—'}</dd>
        </div>
      </dl>
      <AttendanceBar pct={counts.attendance} />
      <InstitutionRowActions
        id={institution.id}
        name={institution.name}
        status={institution.status}
      />
    </article>
  );
}

/* ──────────────────────────────────────── Institution row ── */

function InstitutionRow({
  institution,
  areaName,
  typeName,
  metrics,
  metricsAvailable,
}: {
  institution: Institution;
  areaName: string;
  typeName: string;
  metrics: DirectorySchoolMetrics | undefined;
  metricsAvailable: { students: boolean; staff: boolean };
}) {
  const counts = rowMetrics(institution.status, metrics, {
    students: metricsAvailable.students,
    staff: metricsAvailable.staff,
  });

  return (
    <TableRow className="group">
      {/* School (person-cell) */}
      <TableCell className="sticky start-0 z-10 bg-card">
        <div className="flex items-center gap-3">
          <SchoolMark typeName={typeName} />
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
          <span className={TYPE_CHIP}>{typeName}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Students */}
      <TableCell className="text-end text-sm tabular-nums text-foreground">
        {counts.students !== null ? counts.students.toLocaleString('en-IN') : '—'}
      </TableCell>

      {/* Staff */}
      <TableCell className="text-end text-sm tabular-nums text-foreground">
        {counts.staff !== null ? counts.staff.toLocaleString('en-IN') : '—'}
      </TableCell>

      {/* Attendance */}
      <TableCell>
        <AttendanceBar pct={counts.attendance} />
      </TableCell>

      {/* Status */}
      <TableCell>
        <InstitutionStatusPill status={institution.status} />
      </TableCell>

      {/* Actions */}
      <TableCell className="text-end">
        <InstitutionRowActions
          id={institution.id}
          name={institution.name}
          status={institution.status}
        />
      </TableCell>
    </TableRow>
  );
}

/* ──────────────────────────────────────── Page ── */

export default async function InstitutionsListPage(props: InstitutionsPageProps) {
  const searchParams = await props.searchParams;
  const search = singleParam(searchParams.search) ?? '';
  const areaId = singleParam(searchParams.areaId) || undefined;
  const status = parseStatus(searchParams.status);
  const page = parsePage(searchParams.page);
  const pageSize = DEFAULT_PAGE_SIZE;

  const filtersActive = Boolean(search || areaId || status);
  const [areas, types, listResult, directory, catalogResult] = await Promise.all([
    loadAreaOptions({ fallback: false }),
    loadTypeOptions(),
    fetchInstitutions({ search, areaId, status, page, pageSize, sortBy: 'directory' }),
    loadInstitutionDirectory(),
    filtersActive
      ? fetchInstitutions({ page: 1, pageSize: 1, sortBy: 'directory' })
      : Promise.resolve(null),
  ]);

  // Build a fast area id→name lookup
  const areaById: Record<string, string> = Object.fromEntries(areas.map((a) => [a.id, a.name]));
  const totalItems = listResult.data.meta.totalItems;
  const catalogCount =
    catalogResult && !catalogResult.error ? catalogResult.data.meta.totalItems : totalItems;
  const loadFailed = Boolean(listResult.error);
  const areaCount = areas.length;
  const subtitle = institutionListSubtitle({
    filteredCount: totalItems,
    catalogCount,
    filtersActive,
    failed: loadFailed,
  });

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
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {/*
            An "Export UDISE" button used to sit here with no onClick, no asChild
            and no handler — a dead control advertising a capability that does not
            exist. `packages/backend` and `apps/api-gateway/src` contain zero UDISE
            references: there is no export route, service or return format. Restore
            this button in the same change that lands the backend export, not before.
          */}
          <Button asChild size="sm">
            <Link href="/institutions/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              Register institution
            </Link>
          </Button>
        </div>
      </div>

      {/* ── KPI grid ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiCard
          icon={Building2}
          iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Schools"
          value={loadFailed ? '—' : catalogCount.toLocaleString()}
          foot="across all blocks"
        />
        <KpiCard
          icon={MapIcon}
          iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
          label="Blocks / Areas"
          value={loadFailed ? '—' : areaCount.toLocaleString()}
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
          value={
            loadFailed || directory.studentsEnrolled === null ? (
              loadFailed ? (
                '—'
              ) : (
                <span className="text-lg font-semibold tracking-normal text-muted-foreground">
                  Currently unavailable
                </span>
              )
            ) : (
              directory.studentsEnrolled.toLocaleString('en-IN')
            )
          }
          foot={
            loadFailed
              ? '—'
              : directory.studentsEnrolled === null
                ? 'Enrollment totals are not available yet'
                : 'Enrolled students across schools'
          }
        />
        <KpiCard
          icon={CheckCircle2}
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Reporting today"
          value={
            loadFailed || directory.reportingToday === null ? (
              loadFailed ? (
                '—'
              ) : (
                <span className="text-lg font-semibold tracking-normal text-muted-foreground">
                  Currently unavailable
                </span>
              )
            ) : (
              directory.reportingToday.toLocaleString('en-IN')
            )
          }
          foot={
            loadFailed
              ? '—'
              : directory.reportingToday === null
                ? "Today's attendance reports are not available yet"
                : `${directory.reportingToday.toLocaleString('en-IN')} schools recorded attendance today`
          }
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
        <Card data-testid="institutions-error">
          <CardHeader>
            <CardTitle className="text-destructive">Unable to load institutions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{INSTITUTION_LIST_ERROR}</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/institutions">Try again</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {listResult.data.data.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center gap-2 py-16 text-center"
                data-testid="institutions-empty"
              >
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
                <ul className="divide-y md:hidden" data-testid="institutions-cards">
                  {listResult.data.data.map((institution) => (
                    <li key={institution.id} className="p-4">
                      <InstitutionMobileCard
                        institution={institution}
                        areaName={areaById[institution.areaId] ?? ''}
                        typeName={resolveLookupLabel(types, institution.typeId)}
                        metrics={directory.schools[institution.id]}
                        metricsAvailable={{
                          students: directory.studentsAvailable,
                          staff: directory.staffAvailable,
                        }}
                      />
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <Table
                    aria-label="Institutions"
                    data-testid="institutions-table"
                    className="min-w-[960px]"
                  >
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableHead className="sticky start-0 z-10 bg-card font-semibold">
                          School
                        </TableHead>
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
                          typeName={resolveLookupLabel(types, institution.typeId)}
                          metrics={directory.schools[institution.id]}
                          metricsAvailable={{
                            students: directory.studentsAvailable,
                            staff: directory.staffAvailable,
                          }}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
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
