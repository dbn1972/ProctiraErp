import Link from 'next/link';

import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/lms', label: 'Coursework' },
  { href: '/lms/bank', label: 'Question bank' },
  { href: '/lms/rubrics', label: 'Rubrics' },
  { href: '/lms/discussions', label: 'Discussions' },
  { href: '/lms/lessons', label: 'Lessons' },
  { href: '/lms/content', label: 'Content' },
  { href: '/lms/analytics', label: 'Class analytics' },
  { href: '/lms/pal', label: 'Spiral PAL' },
] as const;

export function LmsSubnav({ current }: { current: string }) {
  return (
    <nav aria-label="Learning sections" className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const active = current === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
            aria-current={active ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
