'use client';

import { useEffect, useState } from 'react';

const nameCache = new Map<string, string>();

/**
 * Resolves an institution UUID breadcrumb segment to a human label (B3-011).
 * Falls back to the shortened id while loading or when the fetch fails.
 */
export function InstitutionBreadcrumbLabel({
  institutionId,
  fallbackLabel,
}: {
  institutionId: string;
  fallbackLabel: string;
}) {
  const cached = nameCache.get(institutionId);
  const [label, setLabel] = useState(cached ?? fallbackLabel);

  useEffect(() => {
    if (cached) {
      setLabel(cached);
      return;
    }

    let cancelled = false;
    void fetch(`/api/entity-labels?institutionId=${encodeURIComponent(institutionId)}`, {
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
        nameCache.set(institutionId, resolved);
        setLabel(resolved);
      })
      .catch(() => {
        if (!cancelled) setLabel(fallbackLabel);
      });

    return () => {
      cancelled = true;
    };
  }, [institutionId, fallbackLabel, cached]);

  return <>{label}</>;
}
