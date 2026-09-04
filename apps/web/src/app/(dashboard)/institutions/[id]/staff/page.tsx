/**
 * Institution Staff tab — Server Component — v2.0 redesign.
 *
 * Cite: redesign/web/institutions-detail.html (Staff tab → staff-list.html)
 * Design System v2.0 — matches sibling institution tabs (classes/grades/…).
 *
 * Lists staff assigned to this institution via assignment APIs
 * (`GET /staff/assignments?institutionId=…`) enriched with staff records.
 * Falls back to `listStaff({ institutionId })` when the convenience filter
 * returns members not yet present in the assignment set.
 */
import Link from 'next/link';
import { Eye, GitBranch, Plus } from 'lucide-react';

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
import {
  getStaff,
  listAssignments,
  listStaff,
  type Assignment,
  type Staff,
} from '@/lib/api/staff';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface StaffPageProps {
  params: { id: string };
}

interface InstitutionStaffRow {
  staff: Staff;
  assignments: Assignment[];
}

const STATUS_PILL: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  INACTIVE: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  ON_LEAVE: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  PROBATION: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
  SUSPENDED: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

const AVATAR_PALETTES = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
] as const;

function avatarPalette(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0];
}

function StatusPill({ status }: { status: string }) {
  const cls =
    STATUS_PILL[status] ??
    'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        cls,
      )}
    >
      {status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

export default async function InstitutionStaffPage({ params }: StaffPageProps) {
  const rows = await loadInstitutionStaff(params.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Staff register</h2>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? 'No staff assigned to this institution yet'
              : `${rows.length.toLocaleString()} ${rows.length === 1 ? 'member' : 'members'} assigned`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/institutions/${params.id}/staff/assign`}>
              <GitBranch className="me-1.5 h-4 w-4" aria-hidden="true" />
              Add assignment
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

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <p className="text-base font-semibold">No staff assigned</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Create a teaching assignment for this institution, or add a new staff
                record and assign them here.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/institutions/${params.id}/staff/assign`}>Add assignment</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/staff/new">Add staff</Link>
                </Button>
              </div>
            </div>
          ) : (
            <Table aria-label="Institution staff">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Staff member</TableHead>
                  <TableHead className="font-semibold">Employee ID</TableHead>
                  <TableHead className="font-semibold">Position</TableHead>
                  <TableHead className="font-semibold">Assignments</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-end font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ staff, assignments }) => {
                  const fullName = `${staff.firstName} ${staff.lastName}`;
                  const initials =
                    `${staff.firstName.charAt(0)}${staff.lastName.charAt(0)}`.toUpperCase();
                  const activeCount = assignments.filter((a) => a.status === 'ACTIVE').length;
                  return (
                    <TableRow key={staff.id} className="group">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                              avatarPalette(fullName),
                            )}
                          >
                            {initials}
                          </span>
                          <div className="min-w-0">
                            <Link
                              href={`/staff/${staff.id}`}
                              className="font-semibold text-foreground hover:underline"
                            >
                              {fullName}
                            </Link>
                            {staff.contactEmail ? (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {staff.contactEmail}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {staff.identityNumber || '—'}
                      </TableCell>
                      <TableCell className="text-sm">{staff.position || '—'}</TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {activeCount > 0
                          ? `${activeCount} active`
                          : `${assignments.length} total`}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={staff.status} />
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                          <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                            <Link
                              href={`/staff/${staff.id}`}
                              aria-label={`View ${fullName}`}
                            >
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          </Button>
                          <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                            <Link
                              href={`/staff/${staff.id}/assignments/new?institutionId=${encodeURIComponent(params.id)}`}
                              aria-label={`Add assignment for ${fullName}`}
                            >
                              <GitBranch className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function loadInstitutionStaff(
  institutionId: string,
): Promise<InstitutionStaffRow[]> {
  const [assignments, staffList] = await Promise.all([
    listAssignments({ institutionId, pageSize: 100 }),
    listStaff({ institutionId, pageSize: 100 }),
  ]);

  const byStaff = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    const list = byStaff.get(assignment.staffId) ?? [];
    list.push(assignment);
    byStaff.set(assignment.staffId, list);
  }

  const staffIds = new Set<string>([
    ...byStaff.keys(),
    ...staffList.data.map((s) => s.id),
  ]);

  const staffMap = new Map<string, Staff>(staffList.data.map((s) => [s.id, s]));
  const missing = [...staffIds].filter((id) => !staffMap.has(id));
  if (missing.length > 0) {
    const fetched = await Promise.all(missing.map((id) => getStaff(id)));
    for (const staff of fetched) {
      if (staff) staffMap.set(staff.id, staff);
    }
  }

  const rows: InstitutionStaffRow[] = [];
  for (const id of staffIds) {
    const staff = staffMap.get(id);
    if (!staff) continue;
    rows.push({
      staff,
      assignments: byStaff.get(id) ?? [],
    });
  }

  rows.sort((a, b) =>
    `${a.staff.lastName} ${a.staff.firstName}`.localeCompare(
      `${b.staff.lastName} ${b.staff.firstName}`,
    ),
  );
  return rows;
}
