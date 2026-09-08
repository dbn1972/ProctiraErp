'use client';

import { useEffect, useState } from 'react';

/**
 * `true` once React has hydrated on the client. Used to stamp interactive
 * forms with `data-hydrated="true"` so E2E drivers can wait for event
 * handlers to be attached instead of racing the server-rendered markup.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
