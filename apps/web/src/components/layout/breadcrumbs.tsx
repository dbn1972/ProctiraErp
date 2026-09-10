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
          <Link
            href="/"
            className="inline-flex min-h-12 min-w-12 items-center justify-center hover:text-foreground"
          >
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
              <Link
                href={crumb.href}
                className="inline-flex min-h-12 min-w-12 items-center justify-center hover:text-foreground"
              >
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

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Formats a URL segment into a human-readable label.
 * UUIDs are shortened (G-1004 / B3-004, B3-011); kebab-case becomes Title Case.
 */
function formatSegmentLabel(segment: string): string {
  if (UUID_SEGMENT.test(segment)) {
    return `${segment.slice(0, 8)}…`;
  }
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
