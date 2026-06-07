/**
 * InstitutionsList — searchable directory of institutions.
 *
 * Wired to `GET /api/v1/institutions` via the browser gateway client (Task 60.3).
 * Supports search and area filtering.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { browserGatewayFetch } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface Institution {
  id: string;
  code: string;
  name: string;
  status: string;
  areaId: string | null;
  parentArea?: { id: string; name: string } | null;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface InstitutionListResponse {
  data: Institution[];
  meta: PaginationMeta;
}

/* ------------------------------------------------------------------ Component */

export default function InstitutionsList() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInstitutions = useCallback(async (page: number, query: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (query) params.set('search', query);
      const result = await browserGatewayFetch<InstitutionListResponse>(
        `/institutions?${params.toString()}`,
      );
      setInstitutions(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load institutions');
      setInstitutions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstitutions(1, search);
  }, [fetchInstitutions, search]);

  const handlePageChange = (newPage: number) => {
    fetchInstitutions(newPage, search);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Institutions</h1>
        <span className="text-sm text-muted-foreground">
          {meta.totalItems > 0 && `${meta.totalItems} institutions`}
        </span>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search by name or code..."
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search institutions"
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
        <div className="space-y-3" data-testid="institutions-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && (
        <div className="rounded-md border">
          <table className="w-full text-sm" data-testid="institutions-table">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Code</th>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Area</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {institutions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No institutions found.
                  </td>
                </tr>
              ) : (
                institutions.map((inst) => (
                  <tr key={inst.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{inst.code}</td>
                    <td className="px-4 py-3 font-medium">{inst.name}</td>
                    <td className="px-4 py-3">{inst.parentArea?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          inst.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {inst.status}
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
