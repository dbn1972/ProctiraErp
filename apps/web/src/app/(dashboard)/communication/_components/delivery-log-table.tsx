'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { DeliveryLogEntry } from '@/lib/api/communication';

import { retryDeliveryAction } from '../actions';

export function DeliveryLogTable({ rows }: { rows: DeliveryLogEntry[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function onRetry(id: string) {
    startTransition(async () => {
      setError(null);
      setPendingId(id);
      const result = await retryDeliveryAction(id);
      setPendingId(null);
      if (result.status === 'error') {
        setError(result.message ?? 'Retry failed');
        return;
      }
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status" data-testid="delivery-log-empty">
        No delivery log rows for this filter.
      </p>
    );
  }

  return (
    <div
      className="space-y-2"
      data-testid="delivery-log-table"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-border" role="list">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
            data-testid="delivery-log-row"
          >
            <div>
              <p className="text-sm font-medium text-foreground">
                {row.channel} · {row.status} · {row.recipientId}
              </p>
              <p className="text-xs text-muted-foreground">
                {row.sourceType}
                {row.providerRef ? ` · ${row.providerRef}` : ''}
                {row.errorMessage ? ` · ${row.errorMessage}` : ''}
              </p>
            </div>
            {row.status === 'failed' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onRetry(row.id)}
                disabled={!hydrated || pendingId === row.id}
              >
                {pendingId === row.id ? 'Retrying…' : 'Retry'}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
