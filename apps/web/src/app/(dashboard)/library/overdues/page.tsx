/**
 * Library overdues (Server Component shell).
 */
import Link from 'next/link';

import { Button } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function LibraryOverduesPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overdues</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Past-due loans via GET `/library/overdues`.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/library">Back to library</Link>
        </Button>
      </div>
    </div>
  );
}
