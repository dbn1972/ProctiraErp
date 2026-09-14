'use client';

import { RouteErrorPanel } from '@/components/route-state/route-error';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorPanel error={error} reset={reset} title="Dashboard error" />;
}
