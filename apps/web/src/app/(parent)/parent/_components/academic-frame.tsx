import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';

import { ChildSwitcher } from './child-switcher';
import type { ParentChildLink } from '@/lib/api/parent-portal';
import { loadStudentLabelsForIds } from '@/lib/load-entity-labels';

export type PickChildResult =
  { child: ParentChildLink; reason: 'ok' } | { child: null; reason: 'no-children' | 'not-linked' };

/**
 * Resolve the child to show. An explicit `?studentId` that is not one of the
 * parent's links yields `not-linked` (render `forbidden`) instead of silently
 * showing the first child (PRC-L063).
 */
export function pickChild(
  links: ParentChildLink[],
  requestedId: string | undefined,
): PickChildResult {
  if (requestedId) {
    const match = links.find((link) => link.studentId === requestedId);
    return match ? { child: match, reason: 'ok' } : { child: null, reason: 'not-linked' };
  }
  const first = links[0];
  return first ? { child: first, reason: 'ok' } : { child: null, reason: 'no-children' };
}

export function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export async function AcademicFrame({
  title,
  description,
  childrenLinks,
  selectedId,
  status,
  errorMessage,
  emptyMessage,
  hasRows,
  children,
  testId,
}: {
  title: string;
  description: string;
  childrenLinks?: ParentChildLink[];
  selectedId?: string;
  status?: 'ok' | 'empty-children' | 'forbidden' | 'not-found' | 'error';
  errorMessage?: string;
  emptyMessage: string;
  hasRows: boolean;
  children: React.ReactNode;
  testId: string;
}) {
  const studentLabels =
    childrenLinks && childrenLinks.length > 0
      ? Object.fromEntries(
          await loadStudentLabelsForIds(childrenLinks.map((link) => link.studentId)),
        )
      : {};

  return (
    <div className="space-y-6" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {childrenLinks && selectedId ? (
          <ChildSwitcher
            childrenLinks={childrenLinks}
            selectedId={selectedId}
            studentLabels={studentLabels}
          />
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>
            {status === 'empty-children'
              ? 'Link a child to see this information.'
              : status === 'forbidden'
                ? 'This record is not available for your account.'
                : status === 'not-found'
                  ? 'This record could not be found.'
                  : status === 'error'
                    ? 'Something went wrong loading this page.'
                    : hasRows
                      ? 'Latest information from the school.'
                      : emptyMessage}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'empty-children' ? (
            <p className="text-sm text-muted-foreground" role="status">
              No linked children yet. Contact your school administrator to link your account.
            </p>
          ) : status === 'forbidden' ? (
            <p className="text-sm text-muted-foreground" role="status">
              You can only view records for students linked to your account.
            </p>
          ) : status === 'not-found' ? (
            <p className="text-sm text-muted-foreground" role="status">
              No record was found. It may not be set up yet for your school.
            </p>
          ) : status === 'error' ? (
            <p className="text-sm text-muted-foreground" role="status">
              {errorMessage ?? 'Unable to load this page. Try again later.'}
            </p>
          ) : hasRows ? (
            children
          ) : (
            <p className="text-sm text-muted-foreground" role="status">
              {emptyMessage}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
