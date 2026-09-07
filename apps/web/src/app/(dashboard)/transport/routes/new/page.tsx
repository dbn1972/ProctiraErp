import Link from 'next/link';

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

export default async function TransportNewRoutePage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New transport route</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create form wires to `POST /api/v1/transport/routes` in the next slice.
        </p>
      </div>
      <Card className="max-w-[720px]">
        <CardHeader>
          <CardTitle className="text-base">Route details</CardTitle>
          <CardDescription>
            Placeholder shell so nav inventory and ungated smokes can land.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild variant="outline">
            <Link href="/transport/routes">Cancel</Link>
          </Button>
          <Button type="button" disabled>
            Create route
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
