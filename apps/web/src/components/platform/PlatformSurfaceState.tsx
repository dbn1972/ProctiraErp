import Link from 'next/link';
import { ChevronLeft, ChevronRight, ShieldAlert, ServerCrash } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle, Button } from '@proctira/ui/components';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';
import type { PageMeta, PlatformListResult } from '@/lib/api/platform.server';

interface PlatformSurfaceStateProps {
  surface: string;
  result: Pick<PlatformListResult<unknown>, 'source' | 'access' | 'errorCode'>;
}

/**
 * Renders the honesty/access state for a platform-scoped list page (G-727):
 * - gateway unreachable → scaffold banner (shared with Insights surfaces)
 * - 403 → explicit "platform administrator required" notice
 * - other gateway error → error alert with the gateway code
 */
export function PlatformSurfaceState({ surface, result }: PlatformSurfaceStateProps) {
  if (result.source === 'scaffold') {
    return (
      <ScaffoldModeBanner
        source="scaffold"
        surface={surface}
        detail={`The gateway is not reachable from this environment, so the ${surface.toLowerCase()} list stays empty instead of showing fixtures.`}
      />
    );
  }
  if (result.access === 'forbidden') {
    return (
      <Alert variant="warning" role="status" data-testid="platform-forbidden-notice">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Platform administrator access required</AlertTitle>
        <AlertDescription>
          {surface} is a platform-level surface. Your current role can browse this page but the
          gateway denied the data request. Sign in with a platform administrator account or ask one
          to grant the <code className="rounded bg-muted px-1 py-0.5 text-xs">platform</code>{' '}
          resource.
        </AlertDescription>
      </Alert>
    );
  }
  if (result.errorCode) {
    return (
      <Alert variant="destructive" role="alert" data-testid="platform-error-notice">
        <ServerCrash className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{surface} could not be loaded</AlertTitle>
        <AlertDescription>
          The gateway responded with{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{result.errorCode}</code>. Retry
          shortly; if it persists, check the gateway logs for this tenant.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

interface PlatformPaginationProps {
  meta: PageMeta;
  /** Builds the href for a given page, preserving current filters. */
  hrefFor: (page: number) => string;
  itemLabel: string;
}

export function PlatformPagination({ meta, hrefFor, itemLabel }: PlatformPaginationProps) {
  if (meta.totalItems === 0) return null;
  const first = (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.page * meta.pageSize, meta.totalItems);
  return (
    <nav
      aria-label={`${itemLabel} pagination`}
      className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        Showing {first.toLocaleString()}–{last.toLocaleString()} of{' '}
        {meta.totalItems.toLocaleString()} {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm" aria-disabled={meta.page <= 1}>
          <Link
            href={hrefFor(Math.max(1, meta.page - 1))}
            aria-label="Previous page"
            tabIndex={meta.page <= 1 ? -1 : undefined}
            className={meta.page <= 1 ? 'pointer-events-none opacity-50' : undefined}
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            Previous
          </Link>
        </Button>
        <span aria-current="page" className="tabular-nums">
          Page {meta.page.toLocaleString()} of {Math.max(1, meta.totalPages).toLocaleString()}
        </span>
        <Button asChild variant="outline" size="sm" aria-disabled={meta.page >= meta.totalPages}>
          <Link
            href={hrefFor(Math.min(Math.max(1, meta.totalPages), meta.page + 1))}
            aria-label="Next page"
            tabIndex={meta.page >= meta.totalPages ? -1 : undefined}
            className={meta.page >= meta.totalPages ? 'pointer-events-none opacity-50' : undefined}
          >
            Next
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </nav>
  );
}

export type SearchParams = Record<string, string | string[] | undefined>;

export function readParam(params: SearchParams | undefined, key: string): string | undefined {
  const value = params?.[key];
  const single = Array.isArray(value) ? value[0] : value;
  return single && single.trim().length > 0 ? single.trim() : undefined;
}

export function readPage(params: SearchParams | undefined): number {
  const raw = Number(readParam(params, 'page'));
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

export function buildHref(
  base: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `${base}?${encoded}` : base;
}
