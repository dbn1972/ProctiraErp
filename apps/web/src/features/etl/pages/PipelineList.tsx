/**
 * PipelineList — displays all ETL pipelines with status, schedule, and execution info.
 *
 * Wired to the ETL Service API (Task 60A.6 / Task 23):
 *   - GET /api/v1/etl/pipelines
 *   - DELETE /api/v1/etl/pipelines/:id
 *   - POST /api/v1/etl/pipelines/:id/execute (trigger manual run)
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

type PipelineStatus = 'active' | 'inactive' | 'running' | 'failed' | 'completed';

interface Pipeline {
  id: string;
  name: string;
  status: PipelineStatus;
  source: {
    type: string;
    name: string;
  };
  destination: {
    type: string;
    name: string;
  };
  schedule: string | null;
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'failed' | 'partial' | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PipelineListResponse {
  data: Pipeline[];
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
  });
}

function getStatusBadgeClass(status: PipelineStatus): string {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-800';
    case 'running':
      return 'bg-blue-100 text-blue-800';
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'inactive':
      return 'bg-gray-100 text-gray-800';
  }
}

function getRunStatusBadgeClass(status: string | null): string {
  switch (status) {
    case 'success':
      return 'bg-green-100 text-green-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'partial':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Converts a cron expression to a human-readable schedule description.
 */
function cronToHuman(cron: string | null): string {
  if (!cron) return 'Manual';
  const parts = cron.split(' ');
  if (parts.length < 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  if (minute === '0' && hour === '*') return 'Every hour';
  if (minute === '0' && hour === '0' && dayOfMonth === '*' && dayOfWeek === '*')
    return 'Daily at midnight';
  if (minute === '0' && hour === '0' && dayOfWeek === '1') return 'Weekly on Monday';
  if (minute === '0' && hour !== '*' && dayOfMonth === '*') return `Daily at ${hour}:00`;

  return cron;
}

/* ------------------------------------------------------------------ Component */

export default function PipelineList() {
  const navigate = useNavigate();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchPipelines = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', '20');

      const result = await browserGatewayFetch<PipelineListResponse>(
        `/etl/pipelines?${params.toString()}`,
      );
      setPipelines(result.data);
      setTotalPages(result.meta.totalPages);
      setTotal(result.meta.total);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load pipelines');
      }
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  const handleTriggerRun = async (pipelineId: string) => {
    try {
      await browserGatewayFetch(`/etl/pipelines/${pipelineId}/execute`, {
        method: 'POST',
      });
      // Refresh list to show updated status
      fetchPipelines();
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(`Failed to trigger pipeline: ${err.message}`);
      } else {
        setError('Failed to trigger pipeline execution');
      }
    }
  };

  const handleDelete = async (pipelineId: string) => {
    if (!window.confirm('Are you sure you want to delete this pipeline?')) return;
    try {
      await browserGatewayFetch(`/etl/pipelines/${pipelineId}`, {
        method: 'DELETE',
      });
      fetchPipelines();
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(`Failed to delete pipeline: ${err.message}`);
      } else {
        setError('Failed to delete pipeline');
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">ETL Pipelines</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} pipeline{total !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchPipelines}
            disabled={isLoading}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            aria-label="Refresh pipelines"
          >
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => navigate('/app/etl/pipelines/new')}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New Pipeline
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

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3" data-testid="pipeline-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && pipelines.length === 0 && !error && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p className="mb-4">No ETL pipelines configured yet.</p>
          <button
            onClick={() => navigate('/app/etl/pipelines/new')}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Create your first pipeline
          </button>
        </div>
      )}

      {/* Pipeline table */}
      {!isLoading && pipelines.length > 0 && (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm" data-testid="pipeline-list-table">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Source</th>
                <th className="px-4 py-3 text-left font-medium">Destination</th>
                <th className="px-4 py-3 text-center font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Schedule</th>
                <th className="px-4 py-3 text-left font-medium">Last Run</th>
                <th className="px-4 py-3 text-left font-medium">Next Run</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pipelines.map((pipeline) => (
                <tr key={pipeline.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{pipeline.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="capitalize">{pipeline.source.type}</span>
                    {pipeline.source.name && ` — ${pipeline.source.name}`}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="capitalize">{pipeline.destination.type}</span>
                    {pipeline.destination.name && ` — ${pipeline.destination.name}`}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(pipeline.status)}`}
                    >
                      {pipeline.status.charAt(0).toUpperCase() + pipeline.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {cronToHuman(pipeline.schedule)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-muted-foreground">
                        {formatDate(pipeline.lastRunAt)}
                      </span>
                      {pipeline.lastRunStatus && (
                        <span
                          className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium ${getRunStatusBadgeClass(pipeline.lastRunStatus)}`}
                        >
                          {pipeline.lastRunStatus.charAt(0).toUpperCase() +
                            pipeline.lastRunStatus.slice(1)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(pipeline.nextRunAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => handleTriggerRun(pipeline.id)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
                        aria-label={`Run pipeline ${pipeline.name}`}
                        title="Run now"
                      >
                        Run
                      </button>
                      <button
                        onClick={() => navigate(`/app/etl/pipelines/${pipeline.id}/logs`)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
                        aria-label={`View logs for ${pipeline.name}`}
                        title="View logs"
                      >
                        Logs
                      </button>
                      <button
                        onClick={() => navigate(`/app/etl/pipelines/${pipeline.id}/edit`)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
                        aria-label={`Edit pipeline ${pipeline.name}`}
                        title="Edit"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(pipeline.id)}
                        className="rounded-md border border-destructive/50 bg-background px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                        aria-label={`Delete pipeline ${pipeline.name}`}
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
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
    </div>
  );
}
