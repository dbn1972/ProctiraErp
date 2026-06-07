/**
 * ScholarshipDisbursementSchedule — finance-facing payout tracker.
 *
 * Displays disbursement records with payment status, scheduled/paid dates,
 * and allows updating payment status (processing, paid, failed, cancelled).
 *
 * Wired to the Scholarship Service API (Task 14):
 *   - GET /api/v1/scholarships/disbursements
 *   - PUT /api/v1/scholarships/disbursements/:id
 *
 * Requirements: 11.4
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

type PaymentStatus = 'scheduled' | 'processing' | 'paid' | 'failed' | 'cancelled';

interface Disbursement {
  id: string;
  tenantId: string;
  applicationId: string;
  amount: number;
  scheduledDate: string;
  paidDate: string | null;
  paymentStatus: PaymentStatus;
  paymentMethod: string | null;
  transactionReference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DisbursementListResponse {
  data: Disbursement[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/* ------------------------------------------------------------------ Helpers */

const STATUS_STYLES: Record<PaymentStatus, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  processing: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
}

/* ------------------------------------------------------------------ Component */

export default function ScholarshipDisbursementSchedule() {
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [meta, setMeta] = useState<DisbursementListResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | ''>('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchDisbursements = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        sortBy: 'scheduledDate',
        sortOrder: 'asc',
      });
      if (statusFilter) params.set('paymentStatus', statusFilter);

      const result = await browserGatewayFetch<DisbursementListResponse>(
        `/scholarships/disbursements?${params.toString()}`,
      );
      setDisbursements(result.data);
      setMeta(result.meta);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load disbursements');
      }
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void fetchDisbursements();
  }, [fetchDisbursements]);

  const handleStatusUpdate = async (id: string, newStatus: PaymentStatus) => {
    setUpdatingId(id);
    setActionError(null);
    try {
      const body: Record<string, string> = { paymentStatus: newStatus };
      if (newStatus === 'paid') {
        body.paidDate = new Date().toISOString().split('T')[0]!;
      }

      await browserGatewayFetch<unknown>(`/scholarships/disbursements/${id}`, {
        method: 'PUT',
        json: body,
      });
      void fetchDisbursements();
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setActionError(err.message);
      } else {
        setActionError('Failed to update disbursement status');
      }
    } finally {
      setUpdatingId(null);
    }
  };

  // Summary stats
  const totalScheduled = disbursements
    .filter((d) => d.paymentStatus === 'scheduled' || d.paymentStatus === 'processing')
    .reduce((sum, d) => sum + d.amount, 0);
  const totalPaid = disbursements
    .filter((d) => d.paymentStatus === 'paid')
    .reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Disbursement Schedule</h1>
          <p className="text-muted-foreground mt-1">
            Track and manage scholarship payment disbursements.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-md border p-4">
          <div className="text-xs text-muted-foreground">Total Records</div>
          <div className="text-2xl font-semibold tabular-nums">{meta?.total ?? 0}</div>
        </div>
        <div className="rounded-md border p-4">
          <div className="text-xs text-muted-foreground">Pending Amount</div>
          <div className="text-2xl font-semibold tabular-nums text-yellow-600">
            {formatCurrency(totalScheduled)}
          </div>
        </div>
        <div className="rounded-md border p-4">
          <div className="text-xs text-muted-foreground">Paid (this page)</div>
          <div className="text-2xl font-semibold tabular-nums text-green-600">
            {formatCurrency(totalPaid)}
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as PaymentStatus | '');
            setPage(1);
          }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="Filter by payment status"
        >
          <option value="">All Statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="processing">Processing</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
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
        <div role="status" aria-label="Loading disbursements" className="text-muted-foreground text-sm">
          Loading disbursements…
        </div>
      )}

      {/* Disbursements table */}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Application</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 text-left font-medium">Scheduled</th>
                <th className="px-4 py-3 text-left font-medium">Paid</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Method</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {disbursements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No disbursements found.
                  </td>
                </tr>
              ) : (
                disbursements.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">
                      {d.applicationId.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {formatCurrency(d.amount)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {formatDate(d.scheduledDate)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {d.paidDate ? formatDate(d.paidDate) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[d.paymentStatus]}`}
                      >
                        {d.paymentStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs capitalize">
                      {d.paymentMethod?.replace(/_/g, ' ') ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {d.paymentStatus === 'scheduled' && (
                        <button
                          onClick={() => handleStatusUpdate(d.id, 'processing')}
                          disabled={updatingId === d.id}
                          className="rounded px-2 py-1 text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 disabled:opacity-50"
                          aria-label={`Mark disbursement ${d.id} as processing`}
                        >
                          Process
                        </button>
                      )}
                      {d.paymentStatus === 'processing' && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleStatusUpdate(d.id, 'paid')}
                            disabled={updatingId === d.id}
                            className="rounded px-2 py-1 text-xs bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
                            aria-label={`Mark disbursement ${d.id} as paid`}
                          >
                            Paid
                          </button>
                          <button
                            onClick={() => handleStatusUpdate(d.id, 'failed')}
                            disabled={updatingId === d.id}
                            className="rounded px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                            aria-label={`Mark disbursement ${d.id} as failed`}
                          >
                            Failed
                          </button>
                        </div>
                      )}
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
            Page {meta.page} of {meta.totalPages} ({meta.total} disbursements)
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
