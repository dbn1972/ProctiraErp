/**
 * Library overview (Server Component).
 */
import Link from 'next/link';
import { BookOpen, RefreshCw } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function LibraryOverviewPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Catalog and circulation. Gateway plugin: `/api/v1/library`.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Circulation
            </CardTitle>
            <CardDescription>Checkout and return loans</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/library/circulation">Open circulation</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Overdues
            </CardTitle>
            <CardDescription>Past-due loans</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/library/overdues">Open overdues</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
