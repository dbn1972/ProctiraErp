/**
 * Notification preferences (G-1001).
 *
 * Route: /notifications/preferences
 * Reuses the settings NotificationPreferences client component.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { DocumentTitle } from '@/components/DocumentTitle';
import NotificationPreferences from '@/features/settings/pages/NotificationPreferences';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function NotificationPreferencesPage() {
  await requireSession('/notifications/preferences');

  return (
    <div className="space-y-4">
      <DocumentTitle pageTitle="Notification preferences" />
      <div className="px-6 pt-6">
        <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
          <Link href="/notifications">
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            Inbox
          </Link>
        </Button>
      </div>
      <NotificationPreferences />
    </div>
  );
}
