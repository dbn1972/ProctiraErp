'use client';

import { RouteErrorPanel } from '@/components/route-state/route-error';

export default function ParentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorPanel error={error} reset={reset} title="Parent portal error" />;
}
