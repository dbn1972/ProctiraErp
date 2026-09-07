'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@proctira/ui/components';

import { updateHostelVisitorStatusAction } from '../../campus-actions';

export function VisitorStatusButtons({ visitorId, status }: { visitorId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const actions =
    status === 'expected'
      ? ([
          { status: 'checked_in' as const, label: 'Check in' },
          { status: 'denied' as const, label: 'Deny' },
        ] as const)
      : status === 'checked_in'
        ? ([{ status: 'checked_out' as const, label: 'Check out' }] as const)
        : [];

  if (actions.length === 0) {
    return null;
  }

  function apply(next: 'checked_in' | 'checked_out' | 'denied') {
    startTransition(async () => {
      setError(null);
      const result = await updateHostelVisitorStatusAction(visitorId, next);
      if (result.status === 'error') {
        setError(result.message ?? 'Update failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.status}
            type="button"
            size="sm"
            variant={action.status === 'denied' ? 'outline' : 'default'}
            className="min-h-11"
            disabled={pending}
            onClick={() => apply(action.status)}
            data-testid={`visitor-${action.status}-button`}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
