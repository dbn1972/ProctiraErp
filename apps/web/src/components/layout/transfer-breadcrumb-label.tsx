'use client';

import { useEffect, useState } from 'react';

const nameCache = new Map<string, string>();

/**
 * Resolves a transfer UUID breadcrumb segment to the student's name.
 */
export function TransferBreadcrumbLabel({
  transferId,
  fallbackLabel,
}: {
  transferId: string;
  fallbackLabel: string;
}) {
  const cached = nameCache.get(transferId);
  const [label, setLabel] = useState(cached ?? fallbackLabel);

  useEffect(() => {
    if (cached) {
      setLabel(cached);
      return;
    }

    let cancelled = false;
    void fetch(`/api/entity-labels?transferId=${encodeURIComponent(transferId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('label unavailable');
        return (await response.json()) as { name?: string };
      })
      .then((body) => {
        if (cancelled) return;
        const resolved = body.name?.trim() || fallbackLabel;
        nameCache.set(transferId, resolved);
        setLabel(resolved);
      })
      .catch(() => {
        if (!cancelled) setLabel(fallbackLabel);
      });

    return () => {
      cancelled = true;
    };
  }, [transferId, fallbackLabel, cached]);

  return <>{label}</>;
}
