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
 */
import { LockKeyhole, ServerCrash, SearchX, UserX } from 'lucide-react';

import type { ListFailureKind } from '@/lib/api/list-result';

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
    title: 'This list is not available',
    description: 'The records could not be found. They may have been moved or removed.',
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
  label,
}: {
  kind: ListFailureKind;
  status?: number;
  label?: string;
}) {
  const { title, description, Icon } = COPY[kind];
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 py-12 text-center"
      data-testid="list-load-failure"
      data-failure-kind={kind}
    >
      <Icon aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
      <h3 className="text-base font-semibold text-foreground">
        {label ? `${label}: ${title.toLowerCase()}` : title}
      </h3>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {status ? <p className="text-xs text-muted-foreground/70">Reference: HTTP {status}</p> : null}
    </div>
  );
}
