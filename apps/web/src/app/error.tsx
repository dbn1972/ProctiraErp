'use client';

/**
 * Root error boundary.
 *
 * ## Why this file was needed
 *
 * `(auth)`, `(dashboard)` and `(parent)` each shipped an `error.tsx`. `(public)`,
 * `(student)`, `(marketing)` and `app/legal` shipped none, and there was no root
 * `error.tsx` or `global-error.tsx` above them — so a render error on any of those 12
 * pages had no boundary at all and fell through to Next's built-in fallback, which in a
 * production build is an unstyled, unbranded "Application error: a client-side exception
 * has occurred" with no retry and no way back.
 *
 * The pages that inherit this are not incidental:
 *
 *   /track                    the applicant-facing admission tracker — used by people
 *                             with no account, who cannot "try the other tab"
 *   /student, /student/*      nine student-portal routes
 *   /legal/privacy, /terms    the two documents the signup form asks users to accept
 *
 * One root boundary closes all four groups, because a React error boundary catches for
 * its whole subtree. Four copies of the same file would have been four things to keep in
 * step.
 *
 * `error.tsx` renders *inside* the root layout, so the theme, tenant tokens and fonts are
 * all still applied here. `global-error.tsx` is the tier below, for when the layout itself
 * is what failed.
 *
 * `route-state-boundaries.test.ts` now asserts this file and `global-error.tsx` exist;
 * before, its recursive floor of "at least 8 error.tsx" was satisfied without either.
 */

import { RouteErrorPanel } from '@/components/route-state/route-error';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorPanel error={error} reset={reset} title="This page could not be loaded" />;
}
