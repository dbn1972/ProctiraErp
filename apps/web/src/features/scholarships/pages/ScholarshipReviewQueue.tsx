/**
 * ScholarshipReviewQueue — reviewer-facing list of pending applications
 * with filters and bulk approve/reject actions.
 *
 * Wired to the Scholarship Service API (Task 14):
 *   - GET  /api/v1/scholarships/applications (filtered by status)
 *   - POST /api/v1/scholarships/applications/:id/approve
 *   - POST /api/v1/scholarships/applications/:id/reject
 *
 * Requirements: 11.2, 11.3
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

type ApplicationStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'withdrawn';

interface ScholarshipApplicationItem {
  id: string;
  programId: string;
  applicantId: string;
  institutionId: string;
  status: ApplicationStatus;
  academicRecords: Array<{
    institutionName: string;
    educationLevel: string;
    gpa?: number;
  }>;
  financialInfo: {
    familyIncome?: number;
    employmentStatus?: string;
  };
  documents: Array<{ documentType: string; fileName: string }>;
  personalStatement: string | null;
  gender: string | null;
  areaId: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  createdAt: string;
}

interface ApplicationListResponse {
  data: ScholarshipApplicationItem[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/* ------------------------------------------------------------------ Helpers */

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  submitted: 'bg-blue-100 text-blue-700',
  under_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-gray-100 text-gray-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ------------------------------------------------------------------ Component */

export default function ScholarshipReviewQueue() {
  const [applications, setApplications] = useState<ScholarshipApplicationItem[]>([]);
  const [meta, setMeta] = useState<ApplicationListResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | ''>('submitted');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (statusFilter) params.set('status', statusFilter);

      const result = await browserGatewayFetch<ApplicationListResponse>(
        `/scholarships/applications?${params.toString()}`,
      );
      setApplications(result.data);
      setMeta(result.meta);
      setSelectedIds(new Set());
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load applications');
      }
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void fetchApplications();
  }, [fetchApplications]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === applications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(applications.map((a) => a.id)));
    }
  };

  const handleBulkAction = async (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) return;
    setBulkProcessing(true);
    setActionError(null);

    const ids = Array.from(selectedIds);
    const errors: string[] = [];

    for (const id of ids) {
      try {
        await browserGatewayFetch<unknown>(`/scholarships/applications/${id}/${action}`, {
          method: 'POST',
        });
      } catch (err) {
        const msg = err instanceof BrowserGatewayError ? err.message : `Failed to ${action} ${id}`;
        errors.push(msg);
      }
    }

    if (errors.length > 0) {
      setActionError(`${errors.length} action(s) failed: ${errors[0]}`);
    }

    setBulkProcessing(false);
    void fetchApplications();
  };

  const handleSingleAction = async (id: string, action: 'approve' | 'reject') => {
    setActionError(null);
    try {
      await browserGatewayFetch<unknown>(`/scholarships/applications/${id}/${action}`, {
        method: 'POST',
      });
      void fetchApplications();
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setActionError(err.message);
      } else {
        setActionError(`Failed to ${action} application`);
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Review Queue</h1>
          <p className="text-muted-foreground mt-1">Review and process scholarship applications.</p>
        </div>
      </div>

      {/* Filters and bulk actions */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as ApplicationStatus | '');
            setPage(1);
          }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="Filter by application status"
        >
          <option value="">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
        </select>

        {selectedIds.size > 0 && (
          <div className="flex gap-2">
            <span className="text-sm text-muted-foreground self-center">
              {selectedIds.size} selected
            </span>
            <button
              onClick={() => handleBulkAction('approve')}
              disabled={bulkProcessing}
              className="rounded-md bg-green-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {bulkProcessing ? 'Processing…' : 'Bulk Approve'}
            </button>
            <button
              onClick={() => handleBulkAction('reject')}
              disabled={bulkProcessing}
              className="rounded-md bg-red-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {bulkProcessing ? 'Processing…' : 'Bulk Reject'}
            </button>
          </div>
        )}
      </div>

      {/* Error states */}
      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}
      {actionError && (
        <div role="alert" className="rounded-md bg-yellow-100 p-3 text-yellow-800 text-sm">
          {actionError}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div
          role="status"
          aria-label="Loading applications"
          className="text-muted-foreground text-sm"
        >
          Loading applications…
        </div>
      )}

      {/* Applications table */}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={applications.length > 0 && selectedIds.size === applications.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all applications"
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium">Applicant</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Education</th>
                <th className="px-4 py-3 text-right font-medium">GPA</th>
                <th className="px-4 py-3 text-left font-medium">Submitted</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {applications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No applications found.
                  </td>
                </tr>
              ) : (
                applications.map((app) => {
                  const topRecord = app.academicRecords[0];
                  return (
                    <tr key={app.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(app.id)}
                          onChange={() => toggleSelect(app.id)}
                          aria-label={`Select application ${app.id}`}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-xs font-mono">
                          {app.applicantId.slice(0, 8)}…
                        </div>
                        {app.gender && (
                          <div className="text-muted-foreground text-xs capitalize">
                            {app.gender}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[app.status]}`}
                        >
                          {app.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {topRecord ? `${topRecord.educationLevel}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {topRecord?.gpa != null ? topRecord.gpa.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">{formatDate(app.submittedAt)}</td>
                      <td className="px-4 py-3">
                        {(app.status === 'submitted' || app.status === 'under_review') && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleSingleAction(app.id, 'approve')}
                              className="rounded px-2 py-1 text-xs bg-green-100 text-green-700 hover:bg-green-200"
                              aria-label={`Approve application ${app.id}`}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleSingleAction(app.id, 'reject')}
                              className="rounded px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200"
                              aria-label={`Reject application ${app.id}`}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {meta.page} of {meta.totalPages} ({meta.total} applications)
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
