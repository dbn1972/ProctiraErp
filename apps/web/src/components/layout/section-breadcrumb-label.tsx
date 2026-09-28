'use client';

import { useEffect, useState } from 'react';

const nameCache = new Map<string, string>();

/**
 * Resolves a timetable section UUID in the breadcrumb to its course name.
 */
export function SectionBreadcrumbLabel({
  sectionId,
  fallbackLabel,
}: {
  sectionId: string;
  fallbackLabel: string;
}) {
  const cached = nameCache.get(sectionId);
  const [label, setLabel] = useState(cached ?? fallbackLabel);

  useEffect(() => {
    if (cached) {
      setLabel(cached);
      return;
    }

    let cancelled = false;
    void fetch(`/api/entity-labels?sectionId=${encodeURIComponent(sectionId)}`, {
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
        nameCache.set(sectionId, resolved);
        setLabel(resolved);
      })
      .catch(() => {
        if (!cancelled) setLabel(fallbackLabel);
      });

    return () => {
      cancelled = true;
    };
  }, [sectionId, fallbackLabel, cached]);

  return <>{label}</>;
}
