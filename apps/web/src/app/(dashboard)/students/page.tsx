/**
 * Student list page (Server Component).
 *
 * Implements Requirement 6.1 (student records) and Requirement 6.7 (bulk
 * import entry point) as the front door of the student management module.
 *
 * Features:
 * - Search by name / national ID
 * - Filter by institution, grade, status
 * - Server-driven pagination through query string
 * - Buttons to create / import students
 */
import Link from 'next/link';
import { Plus, Upload } from 'lucide-react';

import { listInstitutions } from '@/lib/api/institutions';
import { listStudents, type StudentListFilters } from '@/lib/api/students';
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

import { StudentListFilters as Filters } from './_components/student-list-filters';
import { StudentListPagination } from './_components/student-list-pagination';

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

export default async function StudentListPage({ searchParams }: PageProps) {
  const filters: StudentListFilters = {
    page: readNumberParam(searchParams, 'page', 1),
    pageSize: readNumberParam(searchParams, 'pageSize', 20),
    sortBy: 'lastName',
    sortOrder: 'asc',
  };

  const search = readStringParam(searchParams, 'search');
  const institutionId = readStringParam(searchParams, 'institutionId');
  const gradeId = readStringParam(searchParams, 'gradeId');
  const status = readStringParam(searchParams, 'status', 'ALL');

  if (search) filters.search = search;
  if (institutionId) filters.institutionId = institutionId;
  if (gradeId) filters.gradeId = gradeId;
  if (status && status !== 'ALL') {
    filters.status = status as StudentListFilters['status'];
  }

  // Parallelise data fetches.
  const [studentsResponse, institutions] = await Promise.all([
    listStudents(filters),
    listInstitutions({ pageSize: 200 }),
  ]);

  const grades = unique(
    institutions
      .flatMap((inst) => (inst as unknown as { grades?: { id: string; name: string }[] }).grades ?? [])
      .map((g) => ({ id: g.id, name: g.name })),
  );

  return (
    <section aria-labelledby="students-heading" className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="students-heading" className="text-2xl font-semibold tracking-tight">
            Students
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Manage student records, enrollment, and transfers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/students/import">
              <Upload className="me-2 h-4 w-4" aria-hidden="true" />
              Bulk import
            </Link>
          </Button>
          <Button asChild>
            <Link href="/students/new">
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              Add student
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Search and narrow down the student roster.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Filters
            initialValues={{ search, institutionId, gradeId, status }}
            filterOptions={{
              institutions: institutions.map((i) => ({ id: i.id, name: i.name })),
              grades,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Students</CardTitle>
          <CardDescription>
            {studentsResponse.meta.totalItems.toLocaleString()} matching records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {studentsResponse.data.length === 0 ? (
            <EmptyState />
          ) : (
            <Table aria-label="Student records">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>National ID</TableHead>
                  <TableHead>Date of birth</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {studentsResponse.data.map((student) => (
                  <TableRow key={student.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/students/${student.id}`}
                        className="text-[hsl(var(--primary))] hover:underline"
                      >
                        {student.lastName}, {student.firstName}
                      </Link>
                    </TableCell>
                    <TableCell>{student.nationalId ?? '—'}</TableCell>
                    <TableCell>{student.dateOfBirth}</TableCell>
                    <TableCell className="capitalize">{student.gender}</TableCell>
                    <TableCell>
                      <StatusBadge status={readEnrollmentStatus(student)} />
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/students/${student.id}`}>View</Link>
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/students/${student.id}/edit`}>Edit</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <StudentListPagination
            page={studentsResponse.meta.page}
            pageSize={studentsResponse.meta.pageSize}
            totalItems={studentsResponse.meta.totalItems}
            totalPages={studentsResponse.meta.totalPages}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
      <p className="text-base font-medium">No students yet</p>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Add a student manually or use the bulk import flow.
      </p>
      <div className="mt-2 flex gap-2">
        <Button asChild>
          <Link href="/students/new">Add student</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/students/import">Bulk import</Link>
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'ENROLLED':
      return <Badge variant="success">Enrolled</Badge>;
    case 'TRANSFERRED':
      return <Badge variant="secondary">Transferred</Badge>;
    case 'WITHDRAWN':
      return <Badge variant="warning">Withdrawn</Badge>;
    case 'GRADUATED':
      return <Badge variant="outline">Graduated</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
}

function readEnrollmentStatus(
  student: { customData: Record<string, unknown> },
): string {
  const value = student.customData?.['enrollmentStatus'];
  return typeof value === 'string' ? value : 'ENROLLED';
}

function unique<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
