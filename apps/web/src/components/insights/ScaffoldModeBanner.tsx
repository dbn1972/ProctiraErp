import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@proctira/ui/components';

interface ScaffoldModeBannerProps {
  /** Short label for the surface (e.g. "Reports catalog"). */
  surface: string;
  /** Optional extra honesty copy. */
  detail?: string;
  className?: string;
}

/**
 * Honesty banner for Insights & System scaffolds.
 *
 * These routes render stable empty/demo UI when gateway services are offline.
 * Do not imply live warehouse or report backends are connected.
 */
export function ScaffoldModeBanner({
  surface,
  detail,
  className = 'mb-6',
}: ScaffoldModeBannerProps) {
  return (
    <Alert
      variant="warning"
      className={className}
      data-testid="scaffold-mode-banner"
      data-mode="scaffold"
      role="status"
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Scaffold / demo mode — {surface}</AlertTitle>
      <AlertDescription>
        {detail ??
          'Live Insights APIs are not connected in this environment. Forms validate client-side; submits stay demo-only until the gateway is wired.'}
      </AlertDescription>
    </Alert>
  );
}
