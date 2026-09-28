'use client';

import { useEffect, useState } from 'react';

export interface DirectoryContextSnapshot {
  organizationName: string | null;
  boardLabel: string | null;
  studentsEnrolled: number | null;
}

/**
 * Same-origin read of the tenant directory aggregate. The gateway cookie is
 * not visible cross-origin, so this goes through the Next proxy.
 */
export function useDirectoryContext(): DirectoryContextSnapshot | null {
  const [directory, setDirectory] = useState<DirectoryContextSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/v1/institutions/directory-context', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) {
          if (!cancelled) setDirectory(null);
          return;
        }
        const payload = (await response.json()) as DirectoryContextSnapshot;
        if (!cancelled) setDirectory(payload);
      } catch {
        if (!cancelled) setDirectory(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return directory;
}
