import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@proctira/ui/components';

import type { ScaffoldDataSource } from '@/lib/api/insights-source';

export type { ScaffoldDataSource };

interface ScaffoldModeBannerProps {
  /** Short label for the surface (e.g. "Reports catalog"). */
  surface: string;
  /** Optional extra honesty copy. */
  detail?: string;
  className?: string;
  /**
   * When `'gateway'`, the banner is hidden (live Insights APIs responded).
   * When `'scaffold'`, the honesty banner shows.
   */
  source?: ScaffoldDataSource;
  /** Force-show for write scaffolds that never hit a live API yet. */
  force?: boolean;
  /**
   * Override the default "Scaffold / demo mode" title. Use this for callers where the
   * underlying data is real (not a demo/scaffold feature) and the banner instead reflects a
   * transient or access condition, e.g. the gateway being temporarily unreachable.
   */
  title?: string;
}

/**
 * Honesty banner for Insights & System scaffolds.
 *
 * Mirrors Platform Admin `StubDataBanner`: hide when the gateway responded,
 * show when data is scaffold/offline, or when `force` marks a write scaffold.
 */
export function ScaffoldModeBanner({
  surface,
  detail,
  className = 'mb-6',
  source,
  force = false,
  title,
}: ScaffoldModeBannerProps) {
  if (!force && source !== 'scaffold') return null;

  return (
    <Alert
      variant="warning"
      className={className}
      data-testid="scaffold-mode-banner"
      data-mode="scaffold"
      role="status"
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{title ?? `Scaffold / demo mode — ${surface}`}</AlertTitle>
      <AlertDescription>
        {detail ??
          'Live Insights APIs are not connected in this environment. Forms validate client-side; submits stay demo-only until the gateway is wired.'}
      </AlertDescription>
    </Alert>
  );
}
