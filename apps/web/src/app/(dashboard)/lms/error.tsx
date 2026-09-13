'use client';

import { RouteErrorPanel } from '@/components/route-state/route-error';

export default function LmsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorPanel error={error} reset={reset} title="Learning error" />;
}
