'use client';

/**
 * Status tabs for scholarship applications list.
 * Layout cue from redesign/web/scholarships-applications.html.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { cn } from '@/lib/utils';

const STATUS_TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
] as const;

type StatusValue = (typeof STATUS_TABS)[number]['value'];

interface ApplicationStatusTabsProps {
  activeStatus: string;
  counts?: Partial<Record<StatusValue, number>>;
}

export function ApplicationStatusTabs({
  activeStatus,
  counts,
}: ApplicationStatusTabsProps) {
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
    startTransition(() => {
      router.replace(`/scholarships/applications?${params.toString()}`);
    });
  }

  const effective = (activeStatus || 'ALL') as StatusValue;

  return (
    <div
      role="tablist"
      aria-label="Application status"
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
