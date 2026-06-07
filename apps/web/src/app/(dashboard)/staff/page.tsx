/**
 * Staff list page (Server Component).
 *
 * Implements Requirement 7.1 (staff records) — front door of the staff
 * management module. Supports search, position + institution filters, and
 * server-driven pagination.
 */
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { listInstitutions } from '@/lib/api/institutions';
import { listStaff, type StaffListFilters } from '@/lib/api/staff';
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

import { StaffListFilters as Filters } from './_components/staff-list-filters';
import { StaffListPagination } from './_components/staff-list-pagination';

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

const KNOWN_POSITIONS = [
  'Teacher',
  'Principal',
  'Vice Principal',
  'Counselor',
  'Administrator',
  'Support Staff',
];

export default async function StaffListPage({ searchParams }: PageProps) {
  const filters: StaffListFilters = {
    page: readNumberParam(searchParams, 'page', 1),
    pageSize: readNumberParam(searchParams, 'pageSize', 20),
    sortBy: 'lastName',
    sortOrder: 'asc',
  };

  const search = readStringParam(searchParams, 'search');
  const institutionId = readStringParam(searchParams, 'institutionId');
  const position = readStringParam(searchParams, 'position');
  const status = readStringParam(searchParams, 'status', 'ALL');

  if (search) filters.search = search;
  if (institutionId) filters.institutionId = institutionId;
  if (position) filters.position = position;
  if (status && status !== 'ALL') {
    filters.status = status as StaffListFilters['status'];
  }

  const [staffResponse, institutions] = await Promise.all([
    listStaff(filters),
    listInstitutions({ pageSize: 200 }),
  ]);

  return (
    <section aria-labelledby="staff-heading" className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="staff-heading" className="text-2xl font-semibold tracking-tight">
            Staff
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Manage staff records, assignments, and appraisals.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/staff/new">
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              Add staff
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Search and narrow down the staff roster.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Filters
            initialValues={{ search, institutionId, position, status }}
            filterOptions={{
              institutions: institutions.map((i) => ({ id: i.id, name: i.name })),
              positions: KNOWN_POSITIONS,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Staff</CardTitle>
          <CardDescription>
            {staffResponse.meta.totalItems.toLocaleString()} matching records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {staffResponse.data.length === 0 ? (
            <EmptyState />
          ) : (
            <Table aria-label="Staff records">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Identity number</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffResponse.data.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/staff/${member.id}`}
                        className="text-[hsl(var(--primary))] hover:underline"
                      >
                        {member.lastName}, {member.firstName}
                      </Link>
                    </TableCell>
                    <TableCell>{member.identityNumber}</TableCell>
                    <TableCell>{member.position}</TableCell>
                    <TableCell>{member.contactPhone}</TableCell>
                    <TableCell>
                      <StatusBadge status={member.status} />
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/staff/${member.id}`}>View</Link>
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/staff/${member.id}/edit`}>Edit</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <StaffListPagination
            page={staffResponse.meta.page}
            pageSize={staffResponse.meta.pageSize}
            totalItems={staffResponse.meta.totalItems}
            totalPages={staffResponse.meta.totalPages}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
      <p className="text-base font-medium">No staff yet</p>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Add staff manually to get started.
      </p>
      <div className="mt-2 flex gap-2">
        <Button asChild>
          <Link href="/staff/new">Add staff</Link>
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'ACTIVE':
      return <Badge variant="success">Active</Badge>;
    case 'INACTIVE':
      return <Badge variant="secondary">Inactive</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
