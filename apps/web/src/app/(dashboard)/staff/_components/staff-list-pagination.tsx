'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@proctira/ui/components';

interface StaffListPaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export function StaffListPagination({
  page,
  pageSize,
  totalItems,
  totalPages,
}: StaffListPaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function go(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(target));
    router.replace(`/staff?${params.toString()}`);
  }

  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t pt-4 text-sm md:flex-row">
      <p className="text-[hsl(var(--muted-foreground))]" role="status" aria-live="polite">
        Showing <span className="font-medium">{start}</span>–
        <span className="font-medium">{end}</span> of{' '}
        <span className="font-medium">{totalItems}</span> staff
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="me-1 h-4 w-4" aria-hidden="true" />
          Previous
        </Button>
        <span className="text-[hsl(var(--muted-foreground))]">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="ms-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
