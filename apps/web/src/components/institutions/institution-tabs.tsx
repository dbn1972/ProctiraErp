'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'classes', label: 'Classes' },
  { key: 'grades', label: 'Grades' },
  { key: 'timetable', label: 'Timetable' },
  { key: 'infrastructure', label: 'Infrastructure' },
] as const;

export interface InstitutionTabsProps {
  institutionId: string;
  counts?: Partial<Record<(typeof TABS)[number]['key'], number>>;
}

/**
 * Tab navigation for the institution detail pages.
 *
 * Each tab is a real route under `/institutions/[id]/...` so server-rendered
 * data loads fresh on tab change. The active tab is detected from the
 * pathname.
 */
export function InstitutionTabs({ institutionId, counts }: InstitutionTabsProps) {
  const pathname = usePathname();
  const base = `/institutions/${institutionId}`;
  // No fallback: routes like /edit are not tabs and should leave all tabs inactive.
  const activeTab = TABS.find((tab) => pathname.startsWith(`${base}/${tab.key}`))?.key;

  return (
    <nav
      role="tablist"
      aria-label="Institution sections"
      className="-mb-px flex flex-wrap gap-0 border-b border-border"
    >
      {TABS.map((tab) => {
        const href = `${base}/${tab.key}`;
        const isActive = activeTab === tab.key;
        const count = counts?.[tab.key];
        return (
          <Link
            key={tab.key}
            href={href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
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
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
