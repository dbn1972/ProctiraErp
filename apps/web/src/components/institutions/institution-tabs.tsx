'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'grades', label: 'Grades' },
  { key: 'classes', label: 'Classes' },
  { key: 'infrastructure', label: 'Infrastructure' },
] as const;

export interface InstitutionTabsProps {
  institutionId: string;
}

/**
 * Tab navigation for the institution detail pages.
 *
 * Each tab is a real route under `/institutions/[id]/...` so server-rendered
 * data loads fresh on tab change. The active tab is detected from the
 * pathname.
 */
export function InstitutionTabs({ institutionId }: InstitutionTabsProps) {
  const pathname = usePathname();
  const base = `/institutions/${institutionId}`;
  const activeTab = TABS.find((tab) => pathname.startsWith(`${base}/${tab.key}`))?.key
    ?? 'overview';

  return (
    <nav
      role="tablist"
      aria-label="Institution sections"
      className="-mb-px flex flex-wrap gap-1 border-b"
    >
      {TABS.map((tab) => {
        const href = `${base}/${tab.key}`;
        const isActive = activeTab === tab.key;
        return (
          <Link
            key={tab.key}
            href={href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center justify-center whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
