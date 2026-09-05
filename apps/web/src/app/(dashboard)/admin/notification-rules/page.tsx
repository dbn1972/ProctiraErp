/**
 * Admin notification rules list (Server Component).
 *
 * Layout per redesign/web/admin-notification-rules.html:
 *  - Page head with Delivery log / New rule CTAs
 *  - Info alert about DND window
 *  - Rules table with channels and enable state
 *
 * Validates: Requirement 22.2 — configurable notification rules.
 */
import Link from 'next/link';
import { BellRing, Clock, Pencil, Plus, Activity } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  type NotificationRule,
} from '@/lib/api/notifications';
import {
  listNotificationRules,
  listNotificationTemplates,
} from '@/lib/api/notifications.server';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const CHANNEL_STYLES: Record<string, string> = {
  sms: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  push: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  email: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  in_app: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  webhook: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS',
  push: 'Push',
  email: 'Email',
  in_app: 'In-app',
  webhook: 'Webhook',
};

export default async function AdminNotificationRulesPage() {
  const [rules, templates] = await Promise.all([
    listNotificationRules(),
    listNotificationTemplates(),
  ]);

  const templateNames = new Map(templates.map((t) => [t.id, t.name]));

  return (
    <section aria-labelledby="notification-rules-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="notification-rules-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Notification rules
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Event-driven messaging · maps system events to audiences, channels
            and templates.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/notifications">
              <Activity className="me-1.5 h-4 w-4" aria-hidden="true" />
              Delivery log
            </Link>
          </Button>
          <Button size="sm" type="button" disabled>
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New rule
          </Button>
        </div>
      </div>

      <Alert>
        <Clock className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>DND window: 21:00–07:00</AlertTitle>
        <AlertDescription>
          SMS and push triggered during do-not-disturb hours are held and
          retried at 07:00. Email is unaffected. Emergency-class events bypass
          DND.
        </AlertDescription>
      </Alert>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {rules.length === 0 ? (
            <EmptyState />
          ) : (
            <Table aria-label="Notification rules">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Event</TableHead>
                  <TableHead className="font-semibold">Audience</TableHead>
                  <TableHead className="font-semibold">Channels</TableHead>
                  <TableHead className="font-semibold">Template</TableHead>
                  <TableHead className="font-semibold">Enabled</TableHead>
                  <TableHead className="font-semibold">Updated</TableHead>
                  <TableHead className="text-end font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    templateName={
                      templateNames.get(rule.templateId) ?? rule.templateId
                    }
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <BellRing className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">No notification rules yet</p>
      <p className="max-w-[42ch] text-sm text-muted-foreground">
        Rules appear here once configured. Map events like attendance alerts to
        SMS, push, and email templates.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-2">
        <Link href="/admin">Back to administration</Link>
      </Button>
    </div>
  );
}

function RuleRow({
  rule,
  templateName,
}: {
  rule: NotificationRule;
  templateName: string;
}) {
  const audience = formatAudience(rule.recipientQuery);

  return (
    <TableRow className="group">
      <TableCell>
        <code className="font-mono text-xs text-foreground">
          {rule.event || `${rule.entityType}.event`}
        </code>
        <p className="text-xs text-muted-foreground">{rule.name}</p>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{audience}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {(rule.channels.length > 0 ? rule.channels : ['—']).map((ch) => (
            <span
              key={ch}
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide',
                CHANNEL_STYLES[ch] ?? 'bg-muted text-muted-foreground',
              )}
            >
              {CHANNEL_LABELS[ch] ?? ch}
            </span>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-sm">{templateName || '—'}</TableCell>
      <TableCell>
        <span
          className={cn(
            'inline-flex h-5 w-9 items-center rounded-full px-0.5 transition-colors',
            rule.isActive ? 'bg-emerald-500/90' : 'bg-zinc-300 dark:bg-zinc-700',
          )}
          role="switch"
          aria-checked={rule.isActive}
          aria-label={rule.isActive ? 'Enabled' : 'Disabled'}
        >
          <span
            className={cn(
              'h-4 w-4 rounded-full bg-white shadow transition-transform',
              rule.isActive ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(rule.updatedAt)}
      </TableCell>
      <TableCell className="text-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 opacity-60 group-hover:opacity-100"
          type="button"
          disabled
          aria-label={`Edit ${rule.name}`}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function formatAudience(query: Record<string, unknown>): string {
  const role = typeof query.role === 'string' ? query.role : null;
  const roles = Array.isArray(query.roles)
    ? query.roles.filter((r): r is string => typeof r === 'string')
    : [];
  const audience = typeof query.audience === 'string' ? query.audience : null;
  if (audience) return audience;
  if (role) return role;
  if (roles.length > 0) return roles.join(', ');
  return 'Configured recipients';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
