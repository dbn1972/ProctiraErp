import Link from 'next/link';

const LINKS = [
  { href: '/admissions', label: 'Inbox' },
  { href: '/admissions/enquiries', label: 'Enquiries' },
  { href: '/admissions/seat-matrix', label: 'Seat matrix' },
  { href: '/admissions/merit', label: 'Merit list' },
] as const;

export function AdmissionsNav({ current }: { current: string }) {
  return (
    <nav aria-label="Admissions sections" className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const active = current === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-foreground hover:bg-muted'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
