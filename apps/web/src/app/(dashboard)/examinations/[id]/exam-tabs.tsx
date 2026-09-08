'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface ExamTabsProps {
  examId: string;
  candidateCount?: number | null;
}

export function ExamTabs({ examId, candidateCount }: ExamTabsProps) {
  const pathname = usePathname();
  const base = `/examinations/${examId}`;

  const tabs: {
    key: string;
    href: string;
    label: string;
    exact?: boolean;
    count?: number | null;
  }[] = [
    { key: 'overview', href: base, label: 'Overview', exact: true },
    { key: 'candidates', href: `${base}/candidates`, label: 'Candidates', count: candidateCount },
    { key: 'results', href: `${base}/results`, label: 'Results' },
    { key: 'documents', href: `${base}/documents`, label: 'Documents' },
  ];

  return (
    <nav
      role="tablist"
      aria-label="Examination sections"
      className="-mb-px flex flex-wrap gap-0 border-b border-border"
    >
      {tabs.map((tab) => {
        const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        const count = tab.count;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {count !== undefined && count !== null && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums',
                  isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {count.toLocaleString()}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
