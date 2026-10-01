'use client';
/**
 * Status filter for the scholarship applications list.
 * Layout cue from redesign/web/scholarships-applications.html.
 *
 * Rendered as a navigation landmark of links with `aria-current="page"`
 * (PRC-L053): each option changes the URL filter, so link semantics are
 * correct and no tablist/tabpanel/arrow-key contract is implied.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
const STATUS_TABS = [
  { value: 'ALL', labelKey: 'statusFilterAll' },
  { value: 'PENDING', labelKey: 'statusFilterPending' },
  { value: 'UNDER_REVIEW', labelKey: 'statusFilterUnderReview' },
  { value: 'APPROVED', labelKey: 'statusFilterApproved' },
  { value: 'REJECTED', labelKey: 'statusFilterRejected' },
] as const;
type StatusValue = (typeof STATUS_TABS)[number]['value'];
interface ApplicationStatusTabsProps {
  activeStatus: string;
  counts?: Partial<Record<StatusValue, number>>;
}
export function ApplicationStatusTabs({ activeStatus, counts }: ApplicationStatusTabsProps) {
  const t = useTranslations('scholarships');
  const searchParams = useSearchParams();
  function hrefFor(status: StatusValue): string {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (status === 'ALL') {
      params.delete('status');
    } else {
      params.set('status', status);
    }
    const qs = params.toString();
    return qs ? `/scholarships/applications?${qs}` : '/scholarships/applications';
  }
  const effective = (activeStatus || 'ALL') as StatusValue;
  return (
    <nav aria-label={t('statusFilterLabel')} className="overflow-x-auto border-b border-border">
      <ul className="flex gap-0">
        {STATUS_TABS.map((tab) => {
          const isActive = effective === tab.value;
          const count = counts?.[tab.value];
          return (
            <li key={tab.value}>
              <Link
                href={hrefFor(tab.value)}
                replace
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {t(tab.labelKey)}
                {count !== undefined && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px text-xs font-semibold tabular-nums',
                      isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {count.toLocaleString()}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
