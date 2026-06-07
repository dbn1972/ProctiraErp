'use client';

/**
 * ThemeToggle — Header theme cycle control (Task 47.4, Requirement 36 AC 1)
 *
 * Renders a single icon button that cycles the {@link useTheme} mode through
 * `light → dark → system → light`. The icon shown reflects the *currently
 * selected* mode (not the resolved theme), so the user can always see which
 * preference is active:
 *
 *   • `light`  → <Sun />
 *   • `dark`   → <Moon />
 *   • `system` → <Monitor />
 *
 * Per the task contract this control:
 *
 *   1. Mounts inside the authenticated header (`components/layout/header.tsx`)
 *      and the public marketing header (`app/(public)/layout.tsx`). Both sit
 *      below `<ThemeProvider>` in the provider hierarchy (Design §A) so
 *      `useTheme()` is always available regardless of session state.
 *
 *   2. Exposes a localized `aria-label` via `t('theme.toggle')`. The key
 *      lives in the `theme` namespace of `messages/{en,ar}.json` so it is
 *      visible to screen readers in every supported locale, satisfying
 *      both Requirement 36.1 (themeable UI) and the icon-only-button rule
 *      from task 56.5.
 *
 *   3. Uses the shared shadcn/ui Button primitive (`variant="ghost"`,
 *      `size="icon"`) at h/w 10 (40 px). The wrapper bumps the hit-area
 *      to ≥ 48 × 48 px via padding/min-size so the control passes the
 *      Requirement 37 AC 3 touch-target rule on mobile.
 */

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import React from 'react';

import { Button } from '@proctira/ui/components';
import { useTheme, type ThemeMode } from '@/providers/ThemeProvider';

// ─── Cycle order ─────────────────────────────────────────────────────────────

/**
 * The canonical cycle — Light → Dark → System → Light. Exported so tests
 * (and future a11y tooling) can assert the rotation without hard-coding it.
 */
export const THEME_CYCLE: readonly ThemeMode[] = ['light', 'dark', 'system'] as const;

/** Returns the next mode in the cycle. */
export function nextMode(current: ThemeMode): ThemeMode {
  const idx = THEME_CYCLE.indexOf(current);
  // Treat anything unexpected as `light` so we always advance into a valid mode.
  const safeIdx = idx === -1 ? 0 : idx;
  return THEME_CYCLE[(safeIdx + 1) % THEME_CYCLE.length] as ThemeMode;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface ThemeToggleProps {
  /** Optional className passthrough for layout-specific spacing. */
  className?: string;
}

/**
 * Header `<ThemeToggle>` icon button.
 *
 * Validates Task 47.4 (Requirements 36.1, 37.3, 37.4).
 */
export function ThemeToggle({ className }: ThemeToggleProps = {}) {
  const t = useTranslations('theme');
  const { mode, setMode } = useTheme();

  const Icon = mode === 'dark' ? Moon : mode === 'system' ? Monitor : Sun;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setMode(nextMode(mode))}
      aria-label={t('toggle')}
      data-mode={mode}
      data-testid="theme-toggle"
      // Bump the hit area to the 48 × 48 px touch-target floor (Req 37.3).
      // The shadcn icon variant is 40 × 40 px on its own, so we widen via
      // min-h/min-w without disturbing the visual chrome.
      className={['min-h-[48px] min-w-[48px]', className].filter(Boolean).join(' ')}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </Button>
  );
}

export default ThemeToggle;
