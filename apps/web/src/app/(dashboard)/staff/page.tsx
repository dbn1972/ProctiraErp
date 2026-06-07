/**
 * Staff list page (Server Component) — v2.0 redesign.
 *
 * Implements Requirement 7.1 (staff records) — front door of the staff
 * management module. Supports search, school + designation filters, and
 * server-driven pagination.
 *
 * v2.0 changes:
 * - text-3xl font-extrabold heading
 * - "New assignment" + "Add staff" in page-head actions
 * - StaffTypeTabs (All / Teaching / Non-teaching / On leave)
 * - Inline filter bar (no Card wrapper)
 * - Table: person-cell (avatar + name + meta), Employee ID, Designation,
 *   Subjects (tags), School, Status pill, icon-button actions
 */
import Link from 'next/link';
import { Eye, GitBranch, MoreVertical, Pencil, Plus } from 'lucide-react';

import { listInstitutions } from '@/lib/api/institutions';
import { listStaff, type StaffListFilters } from '@/lib/api/staff';
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

import { StaffListFilters as Filters } from './_components/staff-list-filters';
import { StaffListPagination } from './_components/staff-list-pagination';
import { StaffTypeTabs } from './_components/staff-type-tabs';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function readStr(
  params: PageProps['searchParams'],
  key: string,
  fallback = '',
): string {
  if (!params) return fallback;
  const v = params[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0] ?? fallback;
  return fallback;
}

function readNum(
  params: PageProps['searchParams'],
  key: string,
  fallback: number,
): number {
  const raw    = readStr(params, key);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const KNOWN_POSITIONS = [
  'Teacher',
  'Principal',
  'Vice Principal',
  'Counselor',
  'Administrator',
  'Support Staff',
  'Headmaster',
  'PGT',
  'TGT',
  'Clerk',
];

/* ──────────────────────────────────── Avatar palette (same as students) ── */

const AVATAR_PALETTES = [
  'bg-blue-100   text-blue-700   dark:bg-blue-900   dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  'bg-rose-100   text-rose-700   dark:bg-rose-900   dark:text-rose-300',
  'bg-amber-100  text-amber-700  dark:bg-amber-900  dark:text-amber-300',
  'bg-teal-100   text-teal-700   dark:bg-teal-900   dark:text-teal-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300',
] as const;

function avatarPalette(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0];
}

/* ──────────────────────────────────────────────── Helper to read customData ── */

function readCdStr(cd: Record<string, unknown> | null | undefined, key: string): string {
  const v = cd?.[key];
  return typeof v === 'string' ? v : '';
}

function readCdArr(cd: Record<string, unknown> | null | undefined, key: string): string[] {
  const v = cd?.[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/* ──────────────────────────────────────────────── Status pill ── */

const STATUS_PILL: Record<string, string> = {
  ACTIVE:        'bg-emerald-50  text-emerald-700  dark:bg-emerald-950/40 dark:text-emerald-400',
  INACTIVE:      'bg-zinc-100    text-zinc-600     dark:bg-zinc-800       dark:text-zinc-400',
  ON_LEAVE:      'bg-amber-50    text-amber-700    dark:bg-amber-950/40   dark:text-amber-400',
  PROBATION:     'bg-sky-50      text-sky-700      dark:bg-sky-950/40     dark:text-sky-400',
  SUSPENDED:     'bg-red-50      text-red-700      dark:bg-red-950/40     dark:text-red-400',
  RESIGNED:      'bg-zinc-100    text-zinc-500     dark:bg-zinc-800       dark:text-zinc-400',
  RETIRED:       'bg-zinc-100    text-zinc-500     dark:bg-zinc-800       dark:text-zinc-400',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE:    'Active',
  INACTIVE:  'Inactive',
  ON_LEAVE:  'On leave',
  PROBATION: 'Probation',
  SUSPENDED: 'Suspended',
  RESIGNED:  'Resigned',
  RETIRED:   'Retired',
};

function StatusPill({ status }: { status: string }) {
  const cls   = STATUS_PILL[status] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  const label = STATUS_LABEL[status] ?? status;
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

/* ──────────────────────────────────────────────── Staff row ── */

interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  identityNumber: string;
  position: string;
  status: string;
  customData?: Record<string, unknown> | null;
}

function buildSubMeta(member: StaffMember): string {
  const cd       = member.customData ?? {};
  const gender   = readCdStr(cd, 'gender');
  const joinDate = readCdStr(cd, 'joinDate') || readCdStr(cd, 'joinedDate');
  const roleNote = readCdStr(cd, 'roleNote');
  const parts: string[] = [];
  if (gender) parts.push(gender.charAt(0).toUpperCase());
  if (joinDate) {
    const d = new Date(joinDate);
    if (!Number.isNaN(d.getTime())) {
      parts.push(`joined ${d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`);
    }
  }
  if (roleNote) parts.push(roleNote);
  return parts.join(' · ');
}

function StaffRow({ member }: { member: StaffMember }) {
  const cd      = member.customData ?? {};
  const initials = `${member.firstName.charAt(0)}${member.lastName.charAt(0)}`.toUpperCase();
  const fullName = `${member.firstName} ${member.lastName}`;
  const palette  = avatarPalette(fullName);
  const subMeta  = buildSubMeta(member);
  const subjects = readCdArr(cd, 'subjects');
  const school   = readCdStr(cd, 'institutionName') || readCdStr(cd, 'schoolName');
  const designation = readCdStr(cd, 'designation') || member.position;

  return (
    <TableRow className="group">
      {/* Staff member (person-cell) */}
      <TableCell>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              palette,
            )}
          >
            {initials}
          </span>
          <div className="min-w-0">
            <Link
              href={`/staff/${member.id}`}
              className="font-semibold text-foreground hover:underline"
            >
              {fullName}
            </Link>
            {subMeta && (
              <p className="truncate text-[11px] text-muted-foreground">{subMeta}</p>
            )}
          </div>
        </div>
      </TableCell>

      {/* Employee ID */}
      <TableCell className="font-mono text-sm text-muted-foreground">
        {member.identityNumber || '—'}
      </TableCell>

      {/* Designation */}
      <TableCell className="text-sm">{designation || '—'}</TableCell>

      {/* Subjects */}
      <TableCell>
        {subjects.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {subjects.slice(0, 3).map((subj) => (
              <span
                key={subj}
                className="inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-foreground"
              >
                {subj}
              </span>
            ))}
            {subjects.length > 3 && (
              <span className="text-[11px] text-muted-foreground">+{subjects.length - 3}</span>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* School */}
      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground" title={school || undefined}>
        {school || '—'}
      </TableCell>

      {/* Status */}
      <TableCell>
        <StatusPill status={member.status} />
      </TableCell>

      {/* Actions */}
      <TableCell className="text-end">
        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
            <Link href={`/staff/${member.id}`} aria-label={`View ${fullName}`}>
              <Eye className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
            <Link href={`/staff/${member.id}/edit`} aria-label={`Edit ${fullName}`}>
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

/* ──────────────────────────────────────────────── Page ── */

export default async function StaffListPage({ searchParams }: PageProps) {
  const search        = readStr(searchParams, 'search');
  const institutionId = readStr(searchParams, 'institutionId');
  const position      = readStr(searchParams, 'position');
  const status        = readStr(searchParams, 'status', 'ALL');
  const type          = (readStr(searchParams, 'type', 'ALL') || 'ALL') as
    'ALL' | 'TEACHING' | 'NON_TEACHING' | 'ON_LEAVE';

  const filters: StaffListFilters = {
    page:      readNum(searchParams, 'page', 1),
    pageSize:  readNum(searchParams, 'pageSize', 20),
    sortBy:    'lastName',
    sortOrder: 'asc',
  };
  if (search)        filters.search        = search;
  if (institutionId) filters.institutionId = institutionId;
  if (position)      filters.position      = position;
  if (status && status !== 'ALL') filters.status = status as StaffListFilters['status'];

  const [staffResponse, institutions] = await Promise.all([
    listStaff(filters),
    listInstitutions({ pageSize: 200 }),
  ]);

  const totalAll = staffResponse.meta.totalItems;

  return (
    <section aria-labelledby="staff-heading" className="space-y-6">

      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="staff-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Staff
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalAll.toLocaleString()} staff · records, teaching assignments, appraisals, and leave
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/staff/assignments/new">
              <GitBranch className="me-1.5 h-4 w-4" aria-hidden="true" />
              New assignment
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/staff/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              Add staff
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Type tabs ── */}
      <StaffTypeTabs
        activeType={type}
        counts={{ ALL: totalAll }}
      />

      {/* ── Filter bar ── */}
      <div className="py-1">
        <Filters
          initialValues={{ search, institutionId, position, status }}
          filterOptions={{
            institutions: institutions.map((i) => ({ id: i.id, name: i.name })),
            positions: KNOWN_POSITIONS,
          }}
        />
      </div>

      {/* ── Table card ── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {staffResponse.data.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <Table aria-label="Staff records">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-semibold">Staff member</TableHead>
                    <TableHead className="font-semibold">Employee ID</TableHead>
                    <TableHead className="font-semibold">Designation</TableHead>
                    <TableHead className="font-semibold">Subjects</TableHead>
                    <TableHead className="font-semibold">School</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="text-end font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffResponse.data.map((member) => (
                    <StaffRow key={member.id} member={member} />
                  ))}
                </TableBody>
              </Table>
              <div className="border-t px-4 py-3">
                <StaffListPagination
                  page={staffResponse.meta.page}
                  pageSize={staffResponse.meta.pageSize}
                  totalItems={staffResponse.meta.totalItems}
                  totalPages={staffResponse.meta.totalPages}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-base font-semibold">No staff found</p>
      <p className="text-sm text-muted-foreground">
        Try adjusting your filters, or add a new staff member.
      </p>
      <div className="mt-2 flex gap-2">
        <Button asChild size="sm">
          <Link href="/staff/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            Add staff
          </Link>
        </Button>
      </div>
    </div>
  );
}
