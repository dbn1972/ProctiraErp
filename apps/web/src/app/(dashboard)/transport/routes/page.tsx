import Link from 'next/link';
import { Plus } from 'lucide-react';

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

export default async function TransportRoutesPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transport routes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            List and create routes via `/api/v1/transport/routes`.
          </p>
        </div>
        <Button asChild>
          <Link href="/transport/routes/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New route
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Routes</CardTitle>
          <CardDescription>
            Empty until the gateway returns seeded routes for this tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" role="status">
            No routes yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
