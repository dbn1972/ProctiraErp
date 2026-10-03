import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import type { AdminDataSource } from '@/lib/api/gateway';

export type DataSource = AdminDataSource;

interface StubDataBannerProps {
  /** When true (or when source is stub), render the honesty banner. */
  source?: DataSource;
  /** Force-show for write scaffolds that never hit a live API yet. */
  force?: boolean;
  /** Optional extra context for the specific screen. */
  detail?: string;
  className?: string;
}

/**
 * Honest stub/demo mode banner for Platform Admin Console.
 *
 * API clients fall back to deterministic fixtures when the gateway is
 * unreachable. Operators must never confuse that with live production data.
 */
export function StubDataBanner({
  source,
  force = false,
  detail,
  className = 'mb-6',
}: StubDataBannerProps) {
  // PRC-H002: outside ADMIN_CONSOLE_STUB_MODE an unreachable gateway shows no
  // fixtures at all — say so instead of rendering an empty dashboard silently.
  if (!force && source === 'unavailable') {
    return (
      <Alert
        variant="destructive"
        className={className}
        data-testid="stub-data-banner"
        data-mode="unavailable"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Platform gateway unreachable</AlertTitle>
        <AlertDescription>
          Live platform data could not be loaded, so nothing is shown here. This is not an empty
          platform — retry when the gateway is available.
        </AlertDescription>
      </Alert>
    );
  }
  if (!force && source !== 'stub') return null;

  return (
    <Alert variant="warning" className={className} data-testid="stub-data-banner" data-mode="stub">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Stub / demo mode</AlertTitle>
      <AlertDescription>
        {detail ??
          'Upstream platform APIs are unreachable or not wired. This screen shows deterministic fixtures so operators can review the UI — it is not live production data.'}
      </AlertDescription>
    </Alert>
  );
}
