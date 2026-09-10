/**
 * Admin notification rules (G-1002).
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';
import {
  CreateNotificationRuleDialog,
  NotificationRulesTable,
} from '@/components/admin/notification-rules-controls';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';
import {
  listNotificationRules,
  listNotificationTemplates,
} from '@/lib/api/notifications-rules.server';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function NotificationRulesPage() {
  await requireSession('/admin/notification-rules');

  const [{ rules, source: rulesSource }, { templates, source: templatesSource }] =
    await Promise.all([listNotificationRules(), listNotificationTemplates()]);

  const source =
    rulesSource === 'gateway' || templatesSource === 'gateway' ? 'gateway' : rulesSource;

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Notification rules
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Event-driven delivery rules for your school. Emergency campaigns bypass quiet hours.
          </p>
        </div>
        <CreateNotificationRuleDialog templates={templates} />
      </div>

      <ScaffoldModeBanner
        source={source}
        surface="Notification rules"
        detail="Rules stay empty when the notification service is offline."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rules catalog</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationRulesTable rules={rules} />
        </CardContent>
      </Card>
    </div>
  );
}
