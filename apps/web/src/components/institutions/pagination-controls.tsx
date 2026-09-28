'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { formatPageLabel, formatShowingRange } from '@/lib/institutions/directory-presentation';

export interface PaginationControlsProps {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/**
 * URL-driven pagination control. Updates the `page` query string and lets the
 * Server Component re-render with the new slice.
 */
export function PaginationControls({
  page,
  pageSize,
  totalItems,
  totalPages,
}: PaginationControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const goTo = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) {
      params.delete('page');
    } else {
      params.set('page', String(nextPage));
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <nav className="flex items-center justify-between gap-4 text-sm" aria-label="Pagination">
      <p className="text-muted-foreground" aria-live="polite">
        {formatShowingRange(page, pageSize, totalItems)}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 min-h-6 min-w-6"
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 text-muted-foreground">{formatPageLabel(page, totalPages)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 min-h-6 min-w-6"
          onClick={() => goTo(page + 1)}
          disabled={page >= totalPages || totalPages <= 1}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
