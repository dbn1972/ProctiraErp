/**
 * PRC-M154: shown when the resolved tenant is suspended (`active: false`). The
 * middleware redirects every non-public path here. Dependency-free so it renders
 * without a session or gateway.
 */
import Link from 'next/link';
import { ShieldOff } from 'lucide-react';
import { Button } from '@proctira/ui/components';

export const metadata = { title: 'School account suspended' };

export default function TenantSuspendedPage() {
  return (
    <main
      className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center gap-6 px-6 py-16 text-center"
      data-testid="tenant-suspended-page"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <ShieldOff className="h-7 w-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          This school account is suspended
        </h1>
        <p className="text-sm text-muted-foreground">
          Access to this school&apos;s workspace is paused. Contact your school administrator or
          Proctira support to restore access. No data has been changed.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/logout">Sign out</Link>
      </Button>
    </main>
  );
}
