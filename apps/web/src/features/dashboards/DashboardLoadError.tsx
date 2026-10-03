/**
 * PRC-M577 — visible failure state for dashboards. Hooks no longer
 * substitute sample data on 401/403/5xx, so pages render this instead.
 */
import React from 'react';

export interface DashboardLoadErrorProps {
  title: string;
  error: Error;
  'data-testid'?: string;
}

export function DashboardLoadError({
  title,
  error,
  'data-testid': testId = 'dashboard-load-error',
}: DashboardLoadErrorProps) {
  return (
    <div className="space-y-4 p-6" data-testid={testId}>
      <h1 className="text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
        {title}
      </h1>
      <div
        role="alert"
        className="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 p-4 text-sm text-[hsl(var(--foreground))]"
      >
        <p className="font-medium">This dashboard could not be loaded.</p>
        <p className="mt-1 text-[hsl(var(--muted-foreground))]">{error.message}</p>
      </div>
    </div>
  );
}

export default DashboardLoadError;
