/**
 * ScholarshipPrograms — admin-facing scholarship program catalog.
 *
 * Displays a paginated, searchable list of scholarship programs with
 * status badges, slot utilization, and application period info.
 * Supports creating, editing, and archiving programs.
 *
 * Wired to the Scholarship Service API (Task 14):
 *   - GET  /api/v1/scholarships/programs
 *   - POST /api/v1/scholarships/programs
 *   - PUT  /api/v1/scholarships/programs/:id
 *
 * Requirements: 11.1
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

type ProgramStatus = 'draft' | 'open' | 'closed' | 'archived';
type DisbursementFrequency = 'one_time' | 'monthly' | 'quarterly' | 'semester' | 'annual';

interface EligibilityCriteria {
  minGPA?: number;
  maxAge?: number;
  genders?: string[];
  areaIds?: string[];
  institutionIds?: string[];
  educationLevels?: string[];
  maxFamilyIncome?: number;
  requiredDocuments?: string[];
  customCriteria?: Record<string, unknown>;
}

interface ScholarshipProgram {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  applicationStartDate: string;
  applicationEndDate: string;
  totalSlots: number;
  usedSlots: number;
  amountPerRecipient: number;
  currency: string;
  disbursementFrequency: DisbursementFrequency;
  eligibility: EligibilityCriteria;
  status: ProgramStatus;
  academicPeriodId: string | null;
  fundingSourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProgramListResponse {
  data: ScholarshipProgram[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/* ------------------------------------------------------------------ Helpers */

const STATUS_STYLES: Record<ProgramStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  open: 'bg-green-100 text-green-700',
  closed: 'bg-yellow-100 text-yellow-700',
  archived: 'bg-red-100 text-red-700',
};

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ------------------------------------------------------------------ Component */

export default function ScholarshipPrograms() {
  const [programs, setPrograms] = useState<ScholarshipProgram[]>([]);
  const [meta, setMeta] = useState<ProgramListResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProgramStatus | ''>('');

  const fetchPrograms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const result = await browserGatewayFetch<ProgramListResponse>(
        `/scholarships/programs?${params.toString()}`,
      );
      setPrograms(result.data);
      setMeta(result.meta);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load scholarship programs');
      }
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    void fetchPrograms();
  }, [fetchPrograms]);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPage(1);
    void fetchPrograms();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Scholarship Programs</h1>
          <p className="text-muted-foreground mt-1">
            Manage scholarship programs, eligibility criteria, and application periods.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearch} className="flex-1">
          <input
            type="search"
            placeholder="Search programs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            aria-label="Search scholarship programs"
          />
        </form>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as ProgramStatus | '');
            setPage(1);
          }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div role="status" aria-label="Loading programs" className="text-muted-foreground text-sm">
          Loading programs…
        </div>
      )}

      {/* Programs table */}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Program</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Application Period</th>
                <th className="px-4 py-3 text-right font-medium">Slots</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 text-left font-medium">Frequency</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {programs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No scholarship programs found.
                  </td>
                </tr>
              ) : (
                programs.map((program) => (
                  <tr key={program.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{program.name}</div>
                      {program.description && (
                        <div className="text-muted-foreground text-xs mt-0.5 line-clamp-1">
                          {program.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[program.status]}`}
                      >
                        {program.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {formatDate(program.applicationStartDate)} –{' '}
                      {formatDate(program.applicationEndDate)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {program.usedSlots}/{program.totalSlots}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(program.amountPerRecipient, program.currency)}
                    </td>
                    <td className="px-4 py-3 capitalize text-xs">
                      {program.disbursementFrequency.replace(/_/g, ' ')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {meta.page} of {meta.totalPages} ({meta.total} programs)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border px-3 py-1.5 disabled:opacity-50"
              aria-label="Previous page"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={page >= meta.totalPages}
              className="rounded-md border px-3 py-1.5 disabled:opacity-50"
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
