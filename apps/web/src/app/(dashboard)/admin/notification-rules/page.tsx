/**
 * Admin notification rules hub (Server Component).
 */
import Link from 'next/link';
import { ArrowLeft, ListChecks } from 'lucide-react';

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

export default async function NotificationRulesPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/notifications">
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            Inbox
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Notification rules
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure event-driven delivery rules. API: `/api/v1/notifications/rules`. Emergency-class
          campaigns (Comms Center) will bypass quiet hours.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            Rules catalog
          </CardTitle>
          <CardDescription>
            Create and update rules via the notification service. UI editor forms land in the next
            slice; this hub establishes the nav route.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" role="status">
            No rules loaded in this view yet. Use the API or wait for the interactive editor.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
