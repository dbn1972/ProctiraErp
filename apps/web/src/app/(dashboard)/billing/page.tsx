/**
 * Billing — plan catalogue (Server Component, G-727).
 *
 * Reads `GET /api/v1/billing/plans` (platform scope). Subscriptions and
 * usage are keyed by subscription id on the gateway, so the tenant-facing
 * surface is the catalogue plus quota/feature matrix.
 */
import { CreditCard } from 'lucide-react';

import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { DocumentTitle } from '@/components/DocumentTitle';
import {
  buildHref,
  PlatformPagination,
  PlatformSurfaceState,
  readPage,
  readParam,
  type SearchParams,
} from '@/components/platform/PlatformSurfaceState';
import { listBillingPlans, type BillingPlan } from '@/lib/api/platform.server';

export const dynamic = 'force-dynamic';

const TIERS = ['free', 'starter', 'professional', 'enterprise'] as const;
const STATUSES = ['active', 'draft', 'deprecated'] as const;

const TIER_VARIANT: Record<string, 'secondary' | 'default' | 'success' | 'warning' | 'outline'> = {
  free: 'secondary',
  starter: 'outline',
  professional: 'default',
  enterprise: 'success',
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  active: 'success',
  draft: 'warning',
  deprecated: 'destructive',
};

function formatPrice(minor: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export default async function BillingPage({ searchParams }: { searchParams?: SearchParams }) {
  const tier = readParam(searchParams, 'tier');
  const status = readParam(searchParams, 'status');
  const search = readParam(searchParams, 'search');
  const page = readPage(searchParams);

  const result = await listBillingPlans({ tier, status, search, page, pageSize: 20 });
  const plans = result.data;
  const quotaKeys = Array.from(new Set(plans.flatMap((p) => Object.keys(p.quotas)))).sort();

  return (
    <section aria-labelledby="billing-heading" className="space-y-6" data-testid="billing-page">
      <DocumentTitle pageTitle="Billing" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="billing-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Billing
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Subscription plans, quotas and feature entitlements enforced by the gateway.
          </p>
        </div>
      </div>

      <PlatformSurfaceState surface="Billing plans" result={result} />

      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filter plans">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Search
          <input
            type="search"
            name="search"
            defaultValue={search ?? ''}
            placeholder="Plan name"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Tier
          <select
            name="tier"
            defaultValue={tier ?? ''}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="">All tiers</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Status
          <select
            name="status"
            defaultValue={status ?? ''}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Apply
        </button>
      </form>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {plans.length === 0 ? (
            <EmptyState filtered={Boolean(tier ?? status ?? search)} />
          ) : (
            <Table aria-label="Billing plans">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="ps-4 font-semibold">Plan</TableHead>
                  <TableHead className="font-semibold">Tier</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-end font-semibold">Monthly</TableHead>
                  <TableHead className="text-end font-semibold">Yearly</TableHead>
                  <TableHead className="text-end font-semibold">Trial</TableHead>
                  {quotaKeys.map((key) => (
                    <TableHead key={key} className="text-end font-semibold">
                      {humanise(key)}
                    </TableHead>
                  ))}
                  <TableHead className="pe-4 font-semibold">Features</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} quotaKeys={quotaKeys} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PlatformPagination
        meta={result.meta}
        itemLabel="plans"
        hrefFor={(p) => buildHref('/billing', { tier, status, search, page: p })}
      />
    </section>
  );
}

function PlanRow({ plan, quotaKeys }: { plan: BillingPlan; quotaKeys: string[] }) {
  return (
    <TableRow data-testid="billing-plan-row">
      <TableCell className="ps-4">
        <p className="font-semibold text-foreground">{plan.name}</p>
        {plan.description ? (
          <p className="max-w-xs text-[11px] text-muted-foreground">{plan.description}</p>
        ) : null}
      </TableCell>
      <TableCell>
        <Badge variant={TIER_VARIANT[plan.tier] ?? 'outline'}>{plan.tier}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[plan.status] ?? 'secondary'}>{plan.status}</Badge>
      </TableCell>
      <TableCell className="text-end tabular-nums">{formatPrice(plan.priceMonthly)}</TableCell>
      <TableCell className="text-end tabular-nums">{formatPrice(plan.priceYearly)}</TableCell>
      <TableCell className="text-end tabular-nums">
        {plan.trialDays > 0 ? `${plan.trialDays} d` : '—'}
      </TableCell>
      {quotaKeys.map((key) => (
        <TableCell key={key} className="text-end tabular-nums">
          {formatQuota(plan.quotas[key])}
        </TableCell>
      ))}
      <TableCell className="pe-4">
        <div className="flex max-w-sm flex-wrap gap-1">
          {plan.features.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            plan.features.map((f) => (
              <Badge key={f} variant="secondary" className="font-normal">
                {f}
              </Badge>
            ))
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function formatQuota(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value < 0) return 'Unlimited';
  return value.toLocaleString();
}

function humanise(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <CreditCard className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">
        {filtered ? 'No plans match these filters' : 'No billing plans'}
      </p>
      <p className="text-sm text-muted-foreground">
        {filtered
          ? 'Clear the filters to see the full catalogue.'
          : 'Plans are seeded by the platform team via the billing API; none are published yet.'}
      </p>
    </div>
  );
}
