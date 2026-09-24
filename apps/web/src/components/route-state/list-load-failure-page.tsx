import { ListLoadFailure } from './list-load-failure';
import type { ListFailureCopyBundle } from './list-failure-copy';
import type { ListFailureKind } from '@/lib/api/list-result';

/**
 * A whole page whose primary list read failed — heading intact.
 *
 * ## The regression this exists to fix
 *
 * The first V15-10 conversions early-returned the bare panel:
 *
 *     if (!rowsResult.ok) {
 *       return <div className="…"><ListLoadFailure … /></div>;
 *     }
 *
 * which silently dropped the page's `<h1>`. On 17 pages a failed read produced a document
 * with **no level-1 heading at all**. That is an accessibility defect, not just a cosmetic
 * one: the heading is how a screen-reader user knows which page they are on, and it is the
 * anchor the panel's own `h2` is ordered against.
 *
 * Two tests looked like they covered this and did not, which is the part worth remembering:
 *
 *   • `page-h1-presence.test.ts` scans source for `<h1`, and the *success* path still had
 *     one, so the file passed.
 *   • `error-surfaces.a11y.test.tsx` renders the panel inside `<main><h1>…</h1>` and says in
 *     a comment that this "is the real context" — it asserted a context production never
 *     supplied. The test encoded the intended design; the pages had not implemented it.
 *
 * It was caught by `48-library-ops-write-smoke` and `49-hostel-ops-write-smoke` failing on
 * `getByRole('heading', { level: 1 })` — Playwright, which had not been run locally.
 *
 * Using this wrapper rather than repeating the heading markup in every failure branch, so
 * the next converted domain cannot reintroduce the same omission.
 */
export function ListLoadFailurePage({
  heading,
  description,
  actions,
  kind,
  status,
  returnTo,
  requestId,
  copy,
  testId,
}: {
  /** The page's own `h1`. Same text the success path renders. */
  heading: React.ReactNode;
  /** Optional sub-heading, when the success path has one worth keeping. */
  description?: React.ReactNode;
  /** Optional page-level actions (a "back to …" link, typically). */
  actions?: React.ReactNode;
  kind: ListFailureKind;
  status?: number;
  returnTo?: string;
  requestId?: string;
  copy?: ListFailureCopyBundle;
  testId?: string;
}) {
  return (
    <div className="space-y-6 p-6" data-testid={testId ?? 'list-load-failure-page'}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{heading}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <ListLoadFailure
        kind={kind}
        status={status}
        returnTo={returnTo}
        requestId={requestId}
        copy={copy}
      />
    </div>
  );
}
