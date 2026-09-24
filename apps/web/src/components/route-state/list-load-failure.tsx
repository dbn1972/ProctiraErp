/**
 * Panel shown when a list could not be read, instead of an empty table.
 *
 * Each failure kind gets its own copy because the user's next action differs: sign in
 * again, ask for access, or wait and retry. "No records found" — what every one of these
 * rendered as before — tells the user to do nothing, which is wrong in all four cases.
 *
 * `role="status"` rather than `role="alert"`: this renders during normal page load, and
 * an assertive live region would interrupt a screen-reader user mid-navigation. The
 * heading carries the meaning.
 *
 * V15-17 — the English strings below are now **defaults**, not the only option. Pass `copy`
 * from `getListFailureCopy()` in a server component to render the request's locale. They
 * remain as defaults deliberately: an unmigrated caller degrades to today's behaviour rather
 * than rendering blank keys, and the panel stays synchronously renderable by its own test
 * file. See `./list-failure-copy.ts` for why the translation lives outside this module.
 */
import Link from 'next/link';
import { LockKeyhole, ServerCrash, SearchX, UserX } from 'lucide-react';

import { Button } from '@proctira/ui/components';

import type { ListFailureKind } from '@/lib/api/list-result';

import type { ListFailureCopyBundle } from './list-failure-copy';
import { ReloadButton } from './reload-button';

const COPY: Record<
  ListFailureKind,
  { title: string; description: string; Icon: typeof LockKeyhole }
> = {
  unauthenticated: {
    title: 'Your session has expired',
    description: 'Sign in again to load this list.',
    Icon: UserX,
  },
  denied: {
    title: 'You do not have access to this list',
    description:
      'Your role is not permitted to view these records. Contact your administrator if you need access.',
    Icon: LockKeyhole,
  },
  missing: {
    // Not "moved or removed": on this gateway a 404 on a list path usually means the
    // domain is not mounted for this tenant or environment, which is not a data-lifecycle
    // event and must not be described as one.
    title: 'This list is not available here',
    description:
      'These records are not served for this school or environment. Contact your administrator if you expected to see them.',
    Icon: SearchX,
  },
  unavailable: {
    title: 'This list could not be loaded',
    description: 'The service is temporarily unavailable. Reload the page to try again.',
    Icon: ServerCrash,
  },
};

export function ListLoadFailure({
  kind,
  /** Shown as small print so a support conversation can start from a fact. */
  status,
  /** Path to return to after signing in, for the `unauthenticated` case. */
  returnTo,
  /**
   * The gateway's `requestId` from the failed response, when there was one.
   *
   * The gateway generates a request id, logs it and returns it as a header, and now also
   * puts it in the error body. Showing it is the point: HTTP 503 identifies a class of
   * failure, this identifies *the* failure, so support can find the one log line instead
   * of asking what time it happened.
   */
  requestId,
  /**
   * Localised copy from `getListFailureCopy()` (V15-17). Omit it and the English defaults
   * below are used, which is what every unmigrated caller does.
   */
  copy,
}: {
  kind: ListFailureKind;
  status?: number;
  returnTo?: string;
  requestId?: string;
  copy?: ListFailureCopyBundle;
}) {
  const { Icon } = COPY[kind];
  const title = copy?.kinds[kind].title ?? COPY[kind].title;
  const description = copy?.kinds[kind].description ?? COPY[kind].description;
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 py-12 text-center"
      data-testid="list-load-failure"
      data-failure-kind={kind}
    >
      <Icon aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
      {/* h2, not h3: this sits directly under the page h1, and skipping a level is an
          axe heading-order violation. Matches route-error.tsx. */}
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {kind === 'unauthenticated' ? (
        // The one kind whose copy names an action the user can take, so it ships the
        // control to take it rather than leaving them to find the login page.
        <Button asChild size="sm">
          <Link href={returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login'}>
            {copy?.signIn ?? 'Sign in'}
          </Link>
        </Button>
      ) : null}
      {kind === 'unavailable' ? (
        // The copy said "Reload the page to try again" and shipped nothing to do it with,
        // which is the one kind where retrying is the correct next action. A server
        // component read cannot be re-run from the client, so this reloads the route
        // rather than pretending to refetch in place.
        <ReloadButton label={copy?.tryAgain} retryingLabel={copy?.retrying} />
      ) : null}
      {/* `!== undefined`, not truthiness: 0 is the documented status for a network
          failure and must still be quotable. */}
      {status !== undefined ? (
        <p className="text-xs text-muted-foreground/70">
          {copy?.reference ?? 'Reference'}: HTTP {status}
        </p>
      ) : null}
      {requestId ? (
        <p className="font-mono text-xs text-muted-foreground/70" data-testid="failure-request-id">
          {copy?.requestId ?? 'Request ID'}: {requestId}
        </p>
      ) : null}
    </div>
  );
}
