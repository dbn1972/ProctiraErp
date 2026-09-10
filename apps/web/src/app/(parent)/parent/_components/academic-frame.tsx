import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';

import { ChildSwitcher } from './child-switcher';
import type { ParentChildLink } from '@/lib/api/parent-portal';

export function pickChild(
  links: ParentChildLink[],
  requestedId: string | undefined,
): ParentChildLink | null {
  if (links.length === 0) return null;
  if (requestedId) {
    return links.find((link) => link.studentId === requestedId) ?? links[0] ?? null;
  }
  return links[0] ?? null;
}

export function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function AcademicFrame({
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
  status?: 'ok' | 'empty-children' | 'forbidden' | 'error';
  errorMessage?: string;
  emptyMessage: string;
  hasRows: boolean;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="space-y-6" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {childrenLinks && selectedId ? (
          <ChildSwitcher childrenLinks={childrenLinks} selectedId={selectedId} />
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
