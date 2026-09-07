/**
 * Notifications inbox (Server Component) — redesign Services surface.
 */
import Link from 'next/link';
import { Bell, Settings } from 'lucide-react';

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

export default async function NotificationsInboxPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            In-app inbox for tenant alerts. Delivery is served by the gateway notification plugin
            (`/api/v1/notifications`).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/app/settings/notifications">
              <Settings className="me-1.5 h-4 w-4" aria-hidden="true" />
              Preferences
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/notification-rules">Notification rules</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" aria-hidden="true" />
            Inbox
          </CardTitle>
          <CardDescription>
            Authenticated clients load `GET /notifications/user/:userId`. Empty state is intentional
            until the live gateway returns rows for your session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" role="status">
            No notifications yet. Preferences and device registration are live via
            `/notifications/preferences` and `/notifications/devices`.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
