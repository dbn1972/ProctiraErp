import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@proctira/ui/components';

import type { ScaffoldDataSource } from '@/lib/api/insights-source';

export type { ScaffoldDataSource };

interface ScaffoldModeBannerBaseProps {
  /** Short label for the surface (e.g. "Reports catalog"). */
  surface: string;
  /** Optional extra honesty copy. */
  detail?: string;
  className?: string;
  /**
   * Override the default "Scaffold / demo mode" title. Use this for callers where the
   * underlying data is real (not a demo/scaffold feature) and the banner instead reflects a
   * transient or access condition, e.g. the gateway being temporarily unreachable.
   */
  title?: string;
}

/**
 * Callers must state provenance explicitly. The banner is hidden only when
 * `source === 'gateway'`; any other value (including `undefined`) fails closed
 * and shows the warning (PRC-L258).
 */
type ScaffoldModeBannerProps = ScaffoldModeBannerBaseProps &
  (
    | {
        /** Provenance of the data on this surface; only `'gateway'` hides the banner. */
        source: ScaffoldDataSource | undefined;
        force?: false;
      }
    | {
        /** Force-show for write scaffolds that never hit a live API yet. */
        force: true;
        source?: ScaffoldDataSource;
      }
  );

/**
 * Honesty banner for Insights & System scaffolds.
 *
 * Mirrors Platform Admin `StubDataBanner`: hide only when the gateway responded;
 * show when data is scaffold/offline/unknown, or when `force` marks a write scaffold.
 */
export function ScaffoldModeBanner({
  surface,
  detail,
  className = 'mb-6',
  source,
  force = false,
  title,
}: ScaffoldModeBannerProps) {
  if (!force && source === 'gateway') return null;

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
          'Live data for this surface could not be confirmed. Figures may be incomplete and changes may not be saved.'}
      </AlertDescription>
    </Alert>
  );
}
