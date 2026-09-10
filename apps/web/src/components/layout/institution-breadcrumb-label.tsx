'use client';

import { useEffect, useState } from 'react';

import { browserGatewayFetch } from '@/lib/api/browser-gateway';
import { formatCodeNameLabel } from '@/lib/entity-label';

const nameCache = new Map<string, string>();

interface InstitutionSummary {
  id: string;
  code: string;
  name: string;
}

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
    void browserGatewayFetch<InstitutionSummary>(
      `/institutions/${encodeURIComponent(institutionId)}`,
    )
      .then((institution) => {
        if (cancelled) return;
        const resolved = formatCodeNameLabel(institution.code, institution.name) || fallbackLabel;
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
