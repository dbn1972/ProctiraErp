/**
 * StaffDirectory — searchable directory of staff members.
 *
 * Wired to `GET /api/v1/staff` via the browser gateway client (Task 60.3).
 * Supports search, pagination, and position filtering.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { browserGatewayFetch } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface Staff {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  contactPhone: string;
  contactEmail: string | null;
  status: string;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface StaffListResponse {
  data: Staff[];
  meta: PaginationMeta;
}

/* ------------------------------------------------------------------ Component */

export default function StaffDirectory() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStaff = useCallback(async (page: number, query: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (query) params.set('search', query);
      const result = await browserGatewayFetch<StaffListResponse>(
        `/staff?${params.toString()}`,
      );
      setStaff(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff');
      setStaff([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff(1, search);
  }, [fetchStaff, search]);

  const handlePageChange = (newPage: number) => {
    fetchStaff(newPage, search);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Staff Directory</h1>
        <span className="text-sm text-muted-foreground">
          {meta.totalItems > 0 && `${meta.totalItems} staff members`}
        </span>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search by name or position..."
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search staff"
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
        <div className="space-y-3" data-testid="staff-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && (
        <div className="rounded-md border">
          <table className="w-full text-sm" data-testid="staff-table">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Position</th>
                <th className="px-4 py-3 text-left font-medium">Phone</th>
                <th className="px-4 py-3 text-left font-medium">Email</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No staff members found.
                  </td>
                </tr>
              ) : (
                staff.map((member) => (
                  <tr key={member.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      {member.firstName} {member.lastName}
                    </td>
                    <td className="px-4 py-3">{member.position}</td>
                    <td className="px-4 py-3">{member.contactPhone}</td>
                    <td className="px-4 py-3">{member.contactEmail ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          member.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {member.status}
                      </span>
                    </td>
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
