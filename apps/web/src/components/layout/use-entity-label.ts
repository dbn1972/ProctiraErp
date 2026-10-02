'use client';
import { useEffect, useState } from 'react';
/**
 * Shared stale-while-revalidate lookup for breadcrumb entity labels (PRC-L070).
 *
 * The cache only seeds the first paint; every mount revalidates against the
 * server-authorised /api/entity-labels endpoint, so a rename shows up and a
 * label the current session may no longer read (sign-out, tenant switch,
 * revoked access) is evicted instead of being served from memory.
 */
const labelCache = new Map<string, string>();
export type EntityLabelKind = 'institutionId' | 'sectionId';
export function useEntityLabel(kind: EntityLabelKind, id: string, fallbackLabel: string): string {
  const key = `${kind}:${id}`;
  const [label, setLabel] = useState(() => labelCache.get(key) ?? fallbackLabel);
  useEffect(() => {
    let cancelled = false;
    const cached = labelCache.get(key);
    setLabel(cached ?? fallbackLabel);
    void fetch(`/api/entity-labels?${kind}=${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('label unavailable');
        return (await response.json()) as { name?: string };
      })
      .then((body) => {
        if (cancelled) return;
        const resolved = body.name?.trim();
        if (resolved) labelCache.set(key, resolved);
        else labelCache.delete(key);
        setLabel(resolved || fallbackLabel);
      })
      .catch(() => {
        labelCache.delete(key);
        if (!cancelled) setLabel(fallbackLabel);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id, key, fallbackLabel]);
  return label;
}
/** Test/sign-out hook: drop every cached label. */
export function clearEntityLabelCache(): void {
  labelCache.clear();
}
