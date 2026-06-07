'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { cn } from '@/lib/utils';

const STATUS_TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'ENROLLED', label: 'Enrolled' },
  { value: 'PENDING_TRANSFER', label: 'Pending transfer' },
  { value: 'ALUMNI', label: 'Alumni' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
] as const;

type StatusValue = (typeof STATUS_TABS)[number]['value'];

interface StudentStatusTabsProps {
  /** Currently active status from search params (defaults to 'ALL'). */
  activeStatus: string;
  /** Optional per-status counts. If provided, shown as a pill on each tab. */
  counts?: Partial<Record<StatusValue, number>>;
}

/**
 * Horizontal status-filter tabs for the students list page.
 * Uses URL search param `status` — client-side navigation only.
 */
export function StudentStatusTabs({
  activeStatus,
  counts,
}: StudentStatusTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function navigate(status: StatusValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (status === 'ALL') {
      params.delete('status');
    } else {
      params.set('status', status);
    }
    params.delete('page');
    startTransition(() => {
      router.replace(`/students?${params.toString()}`);
    });
  }

  const effective = (activeStatus || 'ALL') as StatusValue;

  return (
    <div
      role="tablist"
      aria-label="Student status"
      className="flex gap-0 overflow-x-auto border-b border-border"
    >
      {STATUS_TABS.map((tab) => {
        const isActive = effective === tab.value;
        const count = counts?.[tab.value];
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => navigate(tab.value)}
            className={cn(
              '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            {tab.label}
            {count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-xs font-semibold tabular-nums',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
