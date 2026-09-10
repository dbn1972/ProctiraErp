/**
 * Student list page (Server Component) — v2.0 redesign.
 *
 * Layout per redesign/web/students-list.html:
 *  - Page head with stats subtitle, Bulk import + Add student CTA
 *  - Status tabs (All / Enrolled / Pending transfer / Alumni / Withdrawn)
 *  - Inline filter bar (search + institution + grade selects)
 *  - Table: avatar person-cell, National ID (mono), Grade/Section,
 *    Institution, Attendance progress bar, Status pill, icon actions
 *  - Footer pagination
 */
import Link from 'next/link';
import { Plus, Upload, Eye, Pencil, MoreVertical } from 'lucide-react';

import { listInstitutions } from '@/lib/api/institutions';
import { listStudents, type Student, type StudentListFilters } from '@/lib/api/students';
import {
  Badge,
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
import { EmptyState } from '@/components/page';
import { cn } from '@/lib/utils';

import { StudentListFilters as Filters } from './_components/student-list-filters';
import { StudentListPagination } from './_components/student-list-pagination';
import { StudentStatusTabs } from './_components/student-status-tabs';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------- helpers */

/** Avatar palette — 6 colours cycled deterministically by name hash. */
const AVATAR_PALETTES: { bg: string; text: string }[] = [
  { bg: 'bg-teal-100', text: 'text-teal-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-rose-100', text: 'text-rose-700' },
];

function avatarPalette(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0]!;
}

/** "18 Apr 2012" from ISO date string */
function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function readStr(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : '';
}

function readNum(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readStringParam(
  params: Awaited<PageProps['searchParams']>,
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
  params: Awaited<PageProps['searchParams']>,
  key: string,
  defaultValue: number,
): number {
  const raw = readStringParam(params, key);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function unique<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/* ------------------------------------------------------------------ page */

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function StudentListPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const page = readNumberParam(searchParams, 'page', 1);
  const search = readStringParam(searchParams, 'search');
  const institutionId = readStringParam(searchParams, 'institutionId');
  const gradeId = readStringParam(searchParams, 'gradeId');
  const status = readStringParam(searchParams, 'status', 'ALL');

  const filters: StudentListFilters = {
    page,
    pageSize: 20,
    sortBy: 'lastName',
    sortOrder: 'asc',
  };
  if (search) filters.search = search;
  if (institutionId) filters.institutionId = institutionId;
  if (gradeId) filters.gradeId = gradeId;
  if (status && status !== 'ALL') {
    filters.status = status as StudentListFilters['status'];
  }

  const [studentsResponse, institutions] = await Promise.all([
    listStudents(filters),
    listInstitutions({ pageSize: 200 }),
  ]);

  const grades = unique(
    institutions
      .flatMap(
        (inst) => (inst as unknown as { grades?: { id: string; name: string }[] }).grades ?? [],
      )
      .map((g) => ({ id: g.id, name: g.name })),
  );

  const totalAll = studentsResponse.meta.totalItems;

  return (
    <section aria-labelledby="students-heading" className="space-y-0">
      {/* ── Page head ── */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="students-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Students
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalAll > 0
              ? `${totalAll.toLocaleString()} students · enrollment, records, and transfers`
              : 'Manage student records, enrollment, and transfers.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/students/import">
              <Upload className="me-1.5 h-4 w-4" aria-hidden="true" />
              Bulk import
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/students/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              Add student
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Status tabs ── */}
      <StudentStatusTabs activeStatus={status} counts={{ ALL: totalAll }} />

      {/* ── Inline filter bar ── */}
      <div className="py-3">
        <Filters
          initialValues={{ search, institutionId, gradeId, status }}
          filterOptions={{
            institutions: institutions.map((i) => ({ id: i.id, name: i.name })),
            grades,
          }}
        />
      </div>

      {/* ── Table card ── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {studentsResponse.data.length === 0 ? (
            <EmptyState
              title="No students found"
              description="Try adjusting your search or filters, or add a student."
              action={
                <>
                  <Button asChild size="sm">
                    <Link href="/students/new">Add student</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/students/import">Bulk import</Link>
                  </Button>
                </>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Student records">
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="ps-4 font-medium">Student</TableHead>
                    <TableHead className="font-medium">National ID</TableHead>
                    <TableHead className="font-medium">Grade / Section</TableHead>
                    <TableHead className="font-medium">Institution</TableHead>
                    <TableHead className="font-medium">Attendance</TableHead>
                    <TableHead className="font-medium">Status</TableHead>
                    <TableHead className="pe-4 text-end font-medium">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studentsResponse.data.map((student) => (
                    <StudentRow key={student.id} student={student} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="border-t px-4 py-3">
            <StudentListPagination
              page={studentsResponse.meta.page}
              pageSize={studentsResponse.meta.pageSize}
              totalItems={studentsResponse.meta.totalItems}
              totalPages={studentsResponse.meta.totalPages}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* --------------------------------------------------------------- row */

function StudentRow({ student }: { student: Student }) {
  const cd = student.customData ?? {};
  const initials = `${student.firstName[0] ?? ''}${student.lastName[0] ?? ''}`.toUpperCase();
  const fullName = `${student.firstName} ${student.lastName}`;
  const palette = avatarPalette(fullName);

  const genderInitial = student.gender ? student.gender[0]?.toUpperCase() : null;
  const dob = student.dateOfBirth ? formatDate(student.dateOfBirth) : null;
  const admNo = readStr(cd, 'admissionNo') || readStr(cd, 'admissionNumber');
  const subParts: string[] = [];
  if (genderInitial) subParts.push(genderInitial);
  if (dob) subParts.push(dob);
  if (admNo) subParts.push(`Adm. ${admNo}`);

  const gradeSection = readStr(cd, 'gradeSection') || readStr(cd, 'grade') || '—';
  const institution = readStr(cd, 'institutionName') || readStr(cd, 'institution') || '—';
  const attendance = readNum(cd, 'attendance') ?? readNum(cd, 'attendanceRate');
  const enrollStatus = readStr(cd, 'enrollmentStatus') || 'ENROLLED';

  return (
    <TableRow className="group">
      {/* Student cell — avatar + name + sub-info */}
      <TableCell className="ps-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              palette.bg,
              palette.text,
            )}
          >
            {initials}
          </span>
          <div className="min-w-0">
            <Link
              href={`/students/${student.id}`}
              className="block truncate font-medium text-foreground hover:text-primary hover:underline"
            >
              {fullName}
            </Link>
            {subParts.length > 0 && (
              <p className="truncate text-xs text-muted-foreground">{subParts.join(' · ')}</p>
            )}
          </div>
        </div>
      </TableCell>

      {/* National ID */}
      <TableCell className="font-mono text-sm text-foreground">
        {student.nationalId ?? '—'}
      </TableCell>

      {/* Grade / Section */}
      <TableCell className="text-sm">{gradeSection}</TableCell>

      {/* Institution */}
      <TableCell className="max-w-[180px] truncate text-sm">{institution}</TableCell>

      {/* Attendance */}
      <TableCell>
        {attendance !== null ? (
          <AttendanceBar pct={Math.round(attendance)} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Status */}
      <TableCell>
        <StatusPill status={enrollStatus} />
      </TableCell>

      {/* Actions */}
      <TableCell className="pe-4">
        <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`View ${fullName}`}
          >
            <Link href={`/students/${student.id}`}>
              <Eye className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`Edit ${fullName}`}
          >
            <Link href={`/students/${student.id}/edit`}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`More options for ${fullName}`}
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* --------------------------------------------------------------- micro-components */

function AttendanceBar({ pct }: { pct: number }) {
  const barColor = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = pct >= 90 ? 'text-foreground' : pct >= 75 ? 'text-amber-700' : 'text-red-600';

  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Attendance ${pct}%`}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn('h-full rounded-full', barColor)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('text-xs font-semibold tabular-nums', textColor)}>{pct}%</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  switch (status.toUpperCase()) {
    case 'ENROLLED':
      return <Badge variant="success">Enrolled</Badge>;
    case 'PENDING_TRANSFER':
    case 'TRANSFERRED':
      return (
        <Badge variant="warning" className="bg-amber-50 text-amber-700">
          Pending transfer
        </Badge>
      );
    case 'AT_RISK':
      return <Badge variant="destructive">At risk</Badge>;
    case 'ALUMNI':
    case 'GRADUATED':
      return (
        <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
          Alumni
        </Badge>
      );
    case 'WITHDRAWN':
      return <Badge variant="secondary">Withdrawn</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
