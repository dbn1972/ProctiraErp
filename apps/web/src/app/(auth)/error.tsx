'use client';

import { RouteErrorPanel } from '@/components/route-state/route-error';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorPanel error={error} reset={reset} title="Sign-in error" />;
}
