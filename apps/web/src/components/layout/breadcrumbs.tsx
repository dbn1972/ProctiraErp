'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

/**
 * Breadcrumb navigation component.
 * Automatically generates breadcrumb trail from the current URL path.
 * Supports RTL layout via logical CSS properties.
 */
export function Breadcrumbs() {
  const t = useTranslations('breadcrumbs');
  const pathname = usePathname();

  // Generate breadcrumb segments from pathname
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const breadcrumbs = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const label = formatSegmentLabel(segment);
    const isLast = index === segments.length - 1;

    return { href, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center text-sm text-muted-foreground" role="list">
        {/* Home link */}
        <li>
          <Link href="/" className="hover:text-foreground">
            {t('home')}
          </Link>
        </li>

        {/* Path segments */}
        {breadcrumbs.map((crumb) => (
          <li key={crumb.href} className="flex items-center">
            <BreadcrumbSeparator />
            {crumb.isLast ? (
              <span className="font-medium text-foreground" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} className="hover:text-foreground">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Breadcrumb separator that respects RTL direction.
 * Uses a chevron that flips automatically in RTL mode.
 */
function BreadcrumbSeparator() {
  return (
    <svg
      className="breadcrumb-separator h-4 w-4 rtl:rotate-180"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

/**
 * Formats a URL segment into a human-readable label.
 * Converts kebab-case to Title Case.
 */
function formatSegmentLabel(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
