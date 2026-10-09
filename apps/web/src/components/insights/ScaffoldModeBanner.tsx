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
   * When `'gateway'`, the banner is hidden (live upstream responded 2xx).
   * Any other value shows an honesty banner: `'scaffold'` (offline/demo),
   * `'denied'` (access rejected — empty list is not "no rows"), or
   * `'unavailable'` (upstream error — data could not be fetched).
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

const SOURCE_COPY: Record<
  Exclude<ScaffoldDataSource, 'gateway'>,
  { title: (surface: string) => string; detail: string }
> = {
  scaffold: {
    title: (surface) => `Scaffold / demo mode — ${surface}`,
    detail:
      'Live Insights APIs are not connected in this environment. Forms validate client-side; submits stay demo-only until the gateway is wired.',
  },
  denied: {
    title: (surface) => `Access restricted — ${surface}`,
    detail:
      'You do not have permission to view this data. The list below is empty because access was denied, not because no records exist.',
  },
  unavailable: {
    title: (surface) => `Temporarily unavailable — ${surface}`,
    detail:
      'This data could not be loaded right now. The list below may be incomplete or empty because the upstream service returned an error — not because no records exist.',
  },
};

/**
 * Honesty banner for Insights & System scaffolds.
 *
 * Mirrors Platform Admin `StubDataBanner`: hide when the gateway responded 2xx,
 * show when data is scaffold/offline/denied/unavailable, or when `force` marks
 * a write scaffold.
 */
export function ScaffoldModeBanner({
  surface,
  detail,
  className = 'mb-6',
  source,
  force = false,
  title,
}: ScaffoldModeBannerProps) {
  // Only a live 2xx gateway response suppresses the banner.
  if (!force && (source === undefined || source === 'gateway')) return null;

  const copy = source && source !== 'gateway' ? SOURCE_COPY[source] : SOURCE_COPY.scaffold;

  return (
    <Alert
      variant="warning"
      className={className}
      data-testid="scaffold-mode-banner"
      data-mode={source && source !== 'gateway' ? source : 'scaffold'}
      role="status"
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{title ?? copy.title(surface)}</AlertTitle>
      <AlertDescription>{detail ?? copy.detail}</AlertDescription>
    </Alert>
  );
}
