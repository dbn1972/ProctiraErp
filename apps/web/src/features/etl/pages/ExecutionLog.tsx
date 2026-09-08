/**
 * ExecutionLog — displays pipeline execution history with row-level detail.
 *
 * Shows:
 *   - List of executions for a pipeline (with extraction/load counts, errors)
 *   - Detailed row-level success/error viewer for a specific execution
 *
 * Wired to the ETL Service API (Task 60A.6 / Task 23):
 *   - GET /api/v1/etl/pipelines/:pipelineId/executions
 *   - GET /api/v1/etl/executions/:executionId
 *
 * Requirements: 14.3, 14.6
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

type ExecutionStatus = 'running' | 'completed' | 'failed' | 'partial';

interface ExecutionSummary {
  id: string;
  pipelineId: string;
  pipelineName: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  extractedCount: number;
  transformedCount: number;
  loadedCount: number;
  errorCount: number;
  retryAttempt: number;
  triggeredBy: 'schedule' | 'manual' | 'retry';
}

interface ExecutionDetail extends ExecutionSummary {
  errors: ExecutionError[];
  logs: ExecutionLogEntry[];
}

interface ExecutionError {
  row: number;
  field: string | null;
  message: string;
  sourceData: Record<string, unknown> | null;
}

interface ExecutionLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

interface ExecutionListResponse {
  data: ExecutionSummary[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/* ------------------------------------------------------------------ Helpers */

function formatDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'Running…';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function getStatusBadgeClass(status: ExecutionStatus): string {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-blue-800';
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'partial':
      return 'bg-yellow-100 text-yellow-800';
  }
}

function getLogLevelClass(level: string): string {
  switch (level) {
    case 'error':
      return 'text-red-700 bg-red-50';
    case 'warn':
      return 'text-yellow-700 bg-yellow-50';
    default:
      return 'text-muted-foreground bg-muted/30';
  }
}

/* ------------------------------------------------------------------ Component */

export default function ExecutionLog() {
  const { pipelineId, executionId } = useParams<{ pipelineId: string; executionId?: string }>();
  const navigate = useNavigate();

  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<ExecutionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Fetch execution list
  const fetchExecutions = useCallback(async () => {
    if (!pipelineId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', '20');

      const result = await browserGatewayFetch<ExecutionListResponse>(
        `/etl/pipelines/${pipelineId}/executions?${params.toString()}`,
      );
      setExecutions(result.data);
      setTotalPages(result.meta.totalPages);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load execution history');
      }
    } finally {
      setIsLoading(false);
    }
  }, [pipelineId, page]);

  // Fetch execution detail
  const fetchExecutionDetail = useCallback(async (execId: string) => {
    setIsLoadingDetail(true);
    setError(null);
    try {
      const result = await browserGatewayFetch<ExecutionDetail>(`/etl/executions/${execId}`);
      setSelectedExecution(result);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load execution details');
      }
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    fetchExecutions();
  }, [fetchExecutions]);

  useEffect(() => {
    if (executionId) {
      fetchExecutionDetail(executionId);
    }
  }, [executionId, fetchExecutionDetail]);

  const handleSelectExecution = (execId: string) => {
    navigate(`/app/etl/pipelines/${pipelineId}/logs/${execId}`);
  };

  const handleBackToList = () => {
    setSelectedExecution(null);
    navigate(`/app/etl/pipelines/${pipelineId}/logs`);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Execution Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pipeline: {executions[0]?.pipelineName || pipelineId}
          </p>
        </div>
        <div className="flex gap-2">
          {selectedExecution && (
            <button
              onClick={handleBackToList}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              ← Back to list
            </button>
          )}
          <button
            onClick={() => navigate('/app/etl/pipelines')}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            All Pipelines
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Execution Detail View */}
      {selectedExecution && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-md border p-4">
              <p className="text-xs text-muted-foreground">Status</p>
              <span
                className={`mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(selectedExecution.status)}`}
              >
                {selectedExecution.status.charAt(0).toUpperCase() +
                  selectedExecution.status.slice(1)}
              </span>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-xs text-muted-foreground">Extracted</p>
              <p className="mt-1 text-lg font-semibold">
                {selectedExecution.extractedCount.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-xs text-muted-foreground">Loaded</p>
              <p className="mt-1 text-lg font-semibold">
                {selectedExecution.loadedCount.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-xs text-muted-foreground">Errors</p>
              <p
                className={`mt-1 text-lg font-semibold ${selectedExecution.errorCount > 0 ? 'text-destructive' : ''}`}
              >
                {selectedExecution.errorCount.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Execution metadata */}
          <div className="rounded-md border p-4 text-sm space-y-1">
            <p>
              <span className="font-medium">Started:</span>{' '}
              {formatDate(selectedExecution.startedAt)}
            </p>
            <p>
              <span className="font-medium">Completed:</span>{' '}
              {formatDate(selectedExecution.completedAt)}
            </p>
            <p>
              <span className="font-medium">Duration:</span>{' '}
              {formatDuration(selectedExecution.startedAt, selectedExecution.completedAt)}
            </p>
            <p>
              <span className="font-medium">Triggered by:</span> {selectedExecution.triggeredBy}
            </p>
            {selectedExecution.retryAttempt > 0 && (
              <p>
                <span className="font-medium">Retry attempt:</span> {selectedExecution.retryAttempt}
              </p>
            )}
          </div>

          {/* Row-level errors */}
          {selectedExecution.errors.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-medium text-destructive">
                Row-Level Errors ({selectedExecution.errors.length})
              </h2>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm" data-testid="execution-errors-table">
                  <thead>
                    <tr className="border-b bg-red-50">
                      <th className="px-4 py-2 text-left font-medium">Row</th>
                      <th className="px-4 py-2 text-left font-medium">Field</th>
                      <th className="px-4 py-2 text-left font-medium">Error</th>
                      <th className="px-4 py-2 text-left font-medium">Source Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedExecution.errors.map((err, idx) => (
                      <tr key={idx} className="border-b hover:bg-red-50/50">
                        <td className="px-4 py-2 font-mono">{err.row}</td>
                        <td className="px-4 py-2 font-mono text-muted-foreground">
                          {err.field || '—'}
                        </td>
                        <td className="px-4 py-2 text-destructive">{err.message}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground max-w-xs truncate">
                          {err.sourceData ? JSON.stringify(err.sourceData) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Execution logs */}
          {selectedExecution.logs.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-medium">Execution Log</h2>
              <div
                className="rounded-md border max-h-96 overflow-y-auto"
                data-testid="execution-log-entries"
              >
                {selectedExecution.logs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-3 border-b px-4 py-2 text-xs font-mono ${getLogLevelClass(log.level)}`}
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="shrink-0 uppercase font-semibold w-12">{log.level}</span>
                    <span className="break-all">{log.message}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Execution List View */}
      {!selectedExecution && (
        <>
          {/* Loading skeleton */}
          {isLoading && (
            <div className="space-y-3" data-testid="execution-log-loading">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && executions.length === 0 && !error && (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No executions recorded for this pipeline yet.
            </div>
          )}

          {/* Execution list table */}
          {!isLoading && executions.length > 0 && (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm" data-testid="execution-list-table">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Started</th>
                    <th className="px-4 py-3 text-center font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Extracted</th>
                    <th className="px-4 py-3 text-right font-medium">Loaded</th>
                    <th className="px-4 py-3 text-right font-medium">Errors</th>
                    <th className="px-4 py-3 text-left font-medium">Duration</th>
                    <th className="px-4 py-3 text-left font-medium">Trigger</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((exec) => (
                    <tr key={exec.id} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(exec.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(exec.status)}`}
                        >
                          {exec.status.charAt(0).toUpperCase() + exec.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {exec.extractedCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {exec.loadedCount.toLocaleString()}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${exec.errorCount > 0 ? 'text-destructive font-semibold' : ''}`}
                      >
                        {exec.errorCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDuration(exec.startedAt, exec.completedAt)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground capitalize">
                        {exec.triggeredBy}
                        {exec.retryAttempt > 0 && ` (#${exec.retryAttempt})`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleSelectExecution(exec.id)}
                          className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
                          aria-label={`View details for execution ${exec.id}`}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between" aria-label="Pagination">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Loading detail overlay */}
          {isLoadingDetail && (
            <div className="fixed inset-0 flex items-center justify-center bg-background/50 z-50">
              <div className="rounded-md border bg-background p-6 shadow-lg">
                <p className="text-sm text-muted-foreground">Loading execution details…</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
