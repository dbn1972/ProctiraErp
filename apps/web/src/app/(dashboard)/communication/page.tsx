/**
 * Communication overview (Server Component).
 */
import Link from 'next/link';
import { Megaphone, Siren } from 'lucide-react';

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

export default async function CommunicationOverviewPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Communication
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Campaigns and dual-confirm emergency blasts. Gateway plugin:
          `/api/v1/communication`.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4" aria-hidden="true" />
              Campaigns
            </CardTitle>
            <CardDescription>Scheduled multi-channel outreach</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/communication/campaigns">Open campaigns</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Siren className="h-4 w-4" aria-hidden="true" />
              Emergency
            </CardTitle>
            <CardDescription>Two-actor confirm before blast</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/communication/emergency">Open emergency</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
