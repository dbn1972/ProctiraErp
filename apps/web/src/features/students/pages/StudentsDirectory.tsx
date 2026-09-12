/**
 * StudentsDirectory — searchable directory of enrolled students.
 *
 * Wired to `GET /api/v1/students` via the browser gateway client (Task 60.3).
 * Supports search, pagination, and status filtering.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { browserGatewayFetch } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  nationalId: string | null;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface StudentListResponse {
  data: Student[];
  meta: PaginationMeta;
}

/* ------------------------------------------------------------------ Component */

export default function StudentsDirectory() {
  const [students, setStudents] = useState<Student[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudents = useCallback(async (page: number, query: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (query) params.set('search', query);
      const result = await browserGatewayFetch<StudentListResponse>(
        `/students?${params.toString()}`,
      );
      setStudents(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load students');
      setStudents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudents(1, search);
  }, [fetchStudents, search]);

  const handlePageChange = (newPage: number) => {
    fetchStudents(newPage, search);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Students Directory</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {meta.totalItems > 0 && `${meta.totalItems} students`}
          </span>
          <a
            href="/students/enroll"
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Enrol student
          </a>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search by name or ID..."
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search students"
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-3" data-testid="students-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && (
        <div className="rounded-md border">
          <table className="w-full text-sm" data-testid="students-table">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Date of Birth</th>
                <th className="px-4 py-3 text-left font-medium">Gender</th>
                <th className="px-4 py-3 text-left font-medium">National ID</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No students found.
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <a
                        href={`/students/${student.id}`}
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {student.firstName} {student.lastName}
                      </a>
                    </td>
                    <td className="px-4 py-3">{student.dateOfBirth}</td>
                    <td className="px-4 py-3 capitalize">{student.gender}</td>
                    <td className="px-4 py-3">{student.nationalId ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {meta.page} of {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              disabled={meta.page <= 1}
              onClick={() => handlePageChange(meta.page - 1)}
            >
              Previous
            </button>
            <button
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              disabled={meta.page >= meta.totalPages}
              onClick={() => handlePageChange(meta.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
