/**
 * Admin access policies list (Server Component).
 *
 * Layout per redesign/web/admin-policies.html:
 *  - Page head with Change history / New policy CTAs
 *  - Info alert about cache propagation
 *  - Policies table + optional side panel for first active policy rules
 *
 * Validates: Requirement 4.x / Charter §27 — tenant access policy browse.
 */
import Link from 'next/link';
import { Eye, History, Info, Pencil, Plus, ScrollText } from 'lucide-react';

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
import { listPolicies, type AccessPolicy } from '@/lib/api/policies';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const SCOPE_LABELS: Record<string, string> = {
  platform: 'Platform',
  tenant: 'District',
  institution: 'School',
};

export default async function AdminPoliciesPage() {
  const policies = await listPolicies();
  const activeCount = policies.filter((p) => p.status === 'active').length;
  const preview = policies.find((p) => p.status === 'active') ?? policies[0] ?? null;

  return (
    <section aria-labelledby="policies-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="policies-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Access policies
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Role-based rules controlling who can view, edit and export records ·
            versioned, with full audit trail.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" type="button" disabled>
            <History className="me-1.5 h-4 w-4" aria-hidden="true" />
            Change history
          </Button>
          <Button size="sm" type="button" disabled>
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New policy
          </Button>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Changes apply within 5 minutes</AlertTitle>
        <AlertDescription>
          Policy updates propagate to all active sessions as access caches
          refresh. Users do not need to sign out and back in.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {policies.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <Table aria-label="Access policies">
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="font-semibold">Policy</TableHead>
                      <TableHead className="font-semibold">Scope</TableHead>
                      <TableHead className="text-end font-semibold">Rules</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Version</TableHead>
                      <TableHead className="font-semibold">Updated</TableHead>
                      <TableHead className="text-end font-semibold">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policies.map((policy) => (
                      <PolicyRow key={policy.id} policy={policy} />
                    ))}
                  </TableBody>
                </Table>
                <div className="border-t px-4 py-3 text-xs text-muted-foreground">
                  {policies.length.toLocaleString()} policies ·{' '}
                  {activeCount.toLocaleString()} active · deactivated policies
                  deny by default and keep their version history
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {preview ? <PolicyPreview policy={preview} /> : <PreviewEmpty />}
        </div>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <ScrollText className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">No access policies yet</p>
      <p className="max-w-[40ch] text-sm text-muted-foreground">
        Policies appear here once the policy service is available for this
        tenant. Create rules to control module access.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-2">
        <Link href="/admin">Back to administration</Link>
      </Button>
    </div>
  );
}

function PreviewEmpty() {
  return (
    <Card>
      <CardContent className="p-5 text-sm text-muted-foreground">
        Select a policy to preview its rules.
      </CardContent>
    </Card>
  );
}

function PolicyRow({ policy }: { policy: AccessPolicy }) {
  const ruleCount = Object.keys(policy.rules ?? {}).length;
  const scopeLabel = SCOPE_LABELS[policy.scope] ?? policy.scope;

  return (
    <TableRow className="group">
      <TableCell>
        <div className="font-semibold text-foreground">{policy.name}</div>
        <p className="text-xs text-muted-foreground">
          {policy.description || policy.type}
        </p>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
          {scopeLabel}
        </span>
      </TableCell>
      <TableCell className="text-end tabular-nums">{ruleCount}</TableCell>
      <TableCell>
        <StatusPill status={policy.status} />
      </TableCell>
      <TableCell>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          v{policy.version}
        </code>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(policy.updatedAt)}
      </TableCell>
      <TableCell className="text-end">
        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            type="button"
            disabled
            aria-label={`View ${policy.name}`}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            type="button"
            disabled
            aria-label={`Edit ${policy.name}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function PolicyPreview({ policy }: { policy: AccessPolicy }) {
  const entries = Object.entries(policy.rules ?? {});
  const scopeLabel = SCOPE_LABELS[policy.scope] ?? policy.scope;

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">
              {policy.name}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <code className="font-mono">v{policy.version}</code> · {scopeLabel}{' '}
              scope · updated {formatDate(policy.updatedAt)}
            </p>
          </div>
          <StatusPill status={policy.status} />
        </div>

        {entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No rule details available for this policy.
          </p>
        ) : (
          <ul className="divide-y" role="list">
            {entries.slice(0, 6).map(([key, value]) => (
              <li key={key} className="flex items-start gap-2.5 py-2.5 text-sm">
                <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                  Rule
                </span>
                <span className="min-w-0 leading-relaxed text-foreground">
                  <span className="font-medium">{key}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {formatRuleValue(value)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button variant="outline" size="sm" type="button" disabled>
            Edit rules
          </Button>
          <Button variant="ghost" size="sm" type="button" disabled>
            Compare versions
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  const active = status === 'active';
  const draft = status === 'draft';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        active &&
          'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
        draft &&
          'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
        !active &&
          !draft &&
          'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
      )}
    >
      {active ? 'Active' : draft ? 'Draft' : 'Inactive'}
    </span>
  );
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

function formatRuleValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}
