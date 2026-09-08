'use client';

/**
 * <ServiceWorkerRegister> — SW lifecycle bootstrap (Task 54.1, Task 60.5,
 * Design §I)
 * =====================================================================
 *
 * Thin React shim that delegates to `registerServiceWorker()` from
 * `@/lib/sw/register`. The gating logic lives in the helper so it is
 * decoupled from React, easy to unit-test, and reusable from any
 * future SPA bootstrap (e.g. a Vite `apps/web/src/main.tsx`) without
 * dragging the React tree along.
 *
 * Mount once near the root of the application (typically inside
 * `<body>` of the root layout) so registration runs as soon as React
 * hydrates. The helper itself is responsible for production-only +
 * secure-context gating, so the component is safe to render in dev
 * and test runs — the `useEffect` will simply short-circuit.
 *
 * The SW file path is hardcoded to `/sw.js` because Next.js serves
 * files from `apps/web/public/` byte-for-byte under the site root and
 * the SW must be at site root to claim navigations across the whole
 * origin.
 */

import { useEffect } from 'react';

import { registerServiceWorker } from '@/lib/sw/register';

export interface ServiceWorkerRegisterProps {
  /**
   * Optional override for the SW file path. Defaults to `/sw.js`.
   * Mostly useful for tests that want to point at a fixture worker.
   */
  scriptUrl?: string;
}

export function ServiceWorkerRegister({ scriptUrl }: ServiceWorkerRegisterProps): null {
  useEffect(() => {
    registerServiceWorker(scriptUrl ? { scriptUrl } : {});
  }, [scriptUrl]);

  return null;
}

export default ServiceWorkerRegister;
