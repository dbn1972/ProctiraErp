/**
 * <WelcomeBanner /> — personalized hero banner above each dashboard.
 *
 * Renders a greeting derived from the user's display name and the
 * current local time (`"Good morning, Aarav"`), an optional brand-aware
 * subtitle (`"Welcome back to ${brand.name}"`), and an attention-summary
 * slot for the most pressing item the user should look at next.
 *
 * Why the brand name is a prop rather than a `useBrand()` call:
 *   - This package lives in the workspace's UI layer and must be
 *     consumable from any app shell. `useBrand()` is currently exported
 *     from `apps/web/src/providers/BrandConfigProvider`, which is not a
 *     workspace package and would create a downward dependency. The web
 *     app passes `brandName={useBrand().name}` at the site of use; mobile
 *     and storybook consumers can pass their own values without having to
 *     mount a Brand provider just to render a banner.
 *
 * Token usage:
 *   - Surface uses `--card` / `--border`.
 *   - Greeting uses `--foreground`; subtitle uses `--muted-foreground`.
 *
 * Loading state (Property F-8): renders skeleton blocks matching the
 * banner layout (greeting, subtitle, attention summary).
 *
 * Async announcement (Design L): polite announcement on
 * loading→loaded.
 */

import type { ReactNode } from 'react';

import { Card, CardContent, Skeleton } from '@proctira/ui-components';

import { cn } from './lib/utils';
import { useAsyncAnnounce } from './lib/useAsyncAnnounce';

/**
 * Resolve a greeting based on a 24-hour clock value. Pure so tests can
 * pin the result regardless of the runtime clock.
 */
export function greetingForHour(hour: number): string {
  if (!Number.isFinite(hour)) return 'Hello';
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export interface WelcomeBannerProps {
  /** User's display name for the greeting (e.g. `"Aarav"`). */
  userName: string;
  /**
   * Tenant brand name for the subtitle (e.g. `"ProctiraERP"`). Pass
   * `useBrand().name` from the consuming app.
   */
  brandName?: string;
  /**
   * Optional override for the current time. When omitted, the banner
   * reads `new Date()` at mount and on every `now` update from the
   * caller. Tests should pass an explicit `Date` for determinism.
   */
  now?: Date;
  /**
   * Optional attention-summary slot rendered to the right of the
   * greeting (typically a sentence like "3 approvals pending today").
   */
  attentionSummary?: ReactNode;
  /** Optional call-to-action slot rendered below the summary. */
  cta?: ReactNode;
  /** Whether the banner is loading. Renders a skeleton when `true`. */
  loading?: boolean;
  /** Override the polite SR announcement on loading→loaded. */
  loadedMessage?: string;
  /** Optional class on the outer `<Card>`. */
  className?: string;
  /** Optional `data-testid`. */
  'data-testid'?: string;
}

export function WelcomeBanner({
  userName,
  brandName,
  now,
  attentionSummary,
  cta,
  loading = false,
  loadedMessage,
  className,
  'data-testid': dataTestId,
}: WelcomeBannerProps) {
  useAsyncAnnounce({
    loading,
    loadedMessage: loadedMessage ?? 'Dashboard ready',
  });

  const clock = now ?? new Date();
  const greeting = greetingForHour(clock.getHours());

  if (loading) {
    return (
      <Card
        className={cn('overflow-hidden', className)}
        aria-busy="true"
        data-testid={dataTestId}
        data-state="loading"
      >
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  // The banner is rendered inside <h1>-style typography; using a
  // `role="banner"` wrapper would conflict with the document landmark
  // contributed by the app shell, so we rely on a labelled <section> here.
  const formattedDate = clock.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Card
      className={cn('overflow-hidden', className)}
      data-testid={dataTestId}
      data-state="ready"
    >
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p
            className="text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]"
            data-testid="welcome-banner-greeting"
          >
            {greeting}, {userName}
          </p>
          {brandName ? (
            <p
              className="text-sm text-[hsl(var(--muted-foreground))]"
              data-testid="welcome-banner-subtitle"
            >
              Welcome back to {brandName}.
            </p>
          ) : null}
          <p
            className="text-xs text-[hsl(var(--muted-foreground))]"
            data-testid="welcome-banner-date"
          >
            {formattedDate}
          </p>
        </div>
        {(attentionSummary || cta) && (
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {attentionSummary ? (
              <div data-testid="welcome-banner-attention">
                {attentionSummary}
              </div>
            ) : null}
            {cta ? <div data-testid="welcome-banner-cta">{cta}</div> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

WelcomeBanner.displayName = 'WelcomeBanner';
