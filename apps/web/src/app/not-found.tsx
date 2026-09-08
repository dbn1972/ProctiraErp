/**
 * App-level 404 (G-727). Rendered inside the root layout for any route that
 * no segment claims, including deep links to modules that were retired from
 * the SPA (`/app/*`). Kept dependency-free so it also renders when the
 * gateway is down.
 */
import Link from 'next/link';
import { Compass } from 'lucide-react';

import { Button } from '@proctira/ui/components';

const SUGGESTIONS = [
  { href: '/', label: 'Dashboard' },
  { href: '/students', label: 'Students' },
  { href: '/attendance', label: 'Attendance' },
  { href: '/reports', label: 'Reports' },
  { href: '/help', label: 'Help' },
] as const;

export default function NotFound() {
  return (
    <main
      className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center gap-6 px-6 py-16 text-center"
      data-testid="not-found-page"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Compass className="h-7 w-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Error 404
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The address may be mistyped, the record may have been removed, or the link points at a
          module that moved. Nothing has been changed.
        </p>
      </div>
      <nav aria-label="Suggested destinations" className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s, index) => (
          <Button key={s.href} asChild variant={index === 0 ? 'default' : 'outline'} size="sm">
            <Link href={s.href}>{s.label}</Link>
          </Button>
        ))}
      </nav>
    </main>
  );
}
