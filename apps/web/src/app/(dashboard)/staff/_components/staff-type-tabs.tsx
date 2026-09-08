'use client';

/**
 * Staff type tabs — client component that drives ?type= URL param.
 *
 * Tabs: All · Teaching · Non-teaching · On leave
 * Mirrors the underline-tab style used in the student list.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { cn } from '@/lib/utils';

type StaffType = 'ALL' | 'TEACHING' | 'NON_TEACHING' | 'ON_LEAVE';

const TABS: { value: StaffType; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'TEACHING', label: 'Teaching' },
  { value: 'NON_TEACHING', label: 'Non-teaching' },
  { value: 'ON_LEAVE', label: 'On leave' },
];

interface StaffTypeTabsProps {
  activeType: StaffType;
  counts?: Partial<Record<StaffType, number>>;
}

export function StaffTypeTabs({ activeType, counts }: StaffTypeTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const navigateTo = useCallback(
    (type: StaffType) => {
      const params = new URLSearchParams(searchParams.toString());
      if (type === 'ALL') {
        params.delete('type');
      } else {
        params.set('type', type);
      }
      params.delete('page');
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div
      role="tablist"
      aria-label="Staff type filter"
      className="-mb-px flex gap-0 border-b border-border"
    >
      {TABS.map((tab) => {
        const isActive = tab.value === activeType;
        const count = counts?.[tab.value];
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => navigateTo(tab.value)}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums',
                  isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
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
