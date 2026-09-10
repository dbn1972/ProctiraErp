'use client';

/**
 * <ConnectivityIndicator> — Three-state online/offline/syncing widget.
 *
 * Task 54.3 / Requirements 38.1, 38.2, 38.3 / Design §I.
 *
 * Renders a coloured dot (≥ 12 px) and a localised text label that
 * reflects the current connectivity state owned by
 * `<ConnectivityProvider>`:
 *
 *   • Online  — solid green dot   (`bg-emerald-500`)   label: "Online"
 *   • Offline — solid yellow dot  (`bg-amber-500`)     label: "Offline"
 *   • Syncing — animated dot      (`bg-sky-500` + `animate-pulse`)
 *                                                      label: "Syncing"
 *
 * The state is driven entirely by `useConnectivity()` — the provider
 * already monitors `navigator.onLine`, the `online`/`offline` events,
 * and a 30-second HEAD `/api/health` heartbeat so transitions resolve
 * within 5 s of the underlying network change (Req 38.2 / 38.3). This
 * component is therefore a pure projection of provider state plus the
 * `useTranslations('connectivity')` call for the visible label.
 *
 * Accessibility (Design §K):
 *   • `role="status"` + `aria-live="polite"` so assistive tech announces
 *     state changes without interrupting the user.
 *   • The dot itself is `aria-hidden` — meaning is conveyed by the
 *     adjacent text label, satisfying the icon + label rule
 *     (Requirement 37.4) and "no colour-only meaning" (Requirement
 *     37.7).
 *   • The dot diameter is 12 px (`h-3 w-3`) per the task brief.
 */

import React from 'react';
import { useTranslations } from 'next-intl';

import { useConnectivity, type ConnectivityStatus } from '@/providers/ConnectivityProvider';
import { cn } from '@/lib/utils';

// ─── State → presentation map ────────────────────────────────────────────────

/**
 * Per-state visual presentation. Centralising the map keeps the JSX
 * branch-free and makes the contract easy to audit when adding a new
 * state in the future.
 *
 * `dotClass` colours come from the Tailwind palette but are
 * intentionally chosen to remain readable in both the light and dark
 * theme tokens — the dots are decorative, the label carries meaning.
 *
 * `labelKey` is the `next-intl` key under the `connectivity` namespace
 * (see `apps/web/src/messages/{en,ar}.json`).
 */
const STATE_PRESENTATION: Record<
  ConnectivityStatus,
  { dotClass: string; labelKey: 'online' | 'offline' | 'syncing' }
> = {
  online: {
    dotClass: 'bg-emerald-500',
    labelKey: 'online',
  },
  offline: {
    // Yellow per the task brief — Tailwind's `amber-500` reads as a
    // saturated yellow that satisfies the 3:1 non-text contrast
    // requirement against both the light and dark backgrounds.
    dotClass: 'bg-amber-500',
    labelKey: 'offline',
  },
  syncing: {
    // Animated pulse signals "in progress" without colour-only meaning;
    // the label still announces "Syncing" to screen-reader users.
    dotClass: 'bg-sky-500 animate-pulse',
    labelKey: 'syncing',
  },
};

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ConnectivityIndicatorProps {
  /** Optional className appended to the root span. */
  className?: string;
  /**
   * When `true`, hides the visible text label and exposes it through
   * `aria-label` only. Used by the mobile shell where header real
   * estate is tight. The dot still meets the 12 px minimum so it is
   * visible at a glance.
   */
  iconOnly?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConnectivityIndicator({ className, iconOnly = false }: ConnectivityIndicatorProps) {
  const { status } = useConnectivity();
  const t = useTranslations('connectivity');

  const presentation = STATE_PRESENTATION[status];
  const label = t(presentation.labelKey);

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={iconOnly ? label : undefined}
      data-testid="connectivity-indicator"
      data-status={status}
      className={cn(
        'inline-flex items-center gap-2 text-sm font-medium text-foreground',
        className,
      )}
    >
      {/* Coloured dot — 12 px diameter (h-3 w-3 in Tailwind). The
          `aria-hidden` flag keeps the meaning on the adjacent text
          label so meaning is never colour-only (Req 37.7). */}
      <span
        aria-hidden="true"
        data-testid="connectivity-indicator-dot"
        className={cn('inline-block h-3 w-3 shrink-0 rounded-full', presentation.dotClass)}
      />
      {iconOnly ? null : <span data-testid="connectivity-indicator-label">{label}</span>}
    </span>
  );
}

export default ConnectivityIndicator;
