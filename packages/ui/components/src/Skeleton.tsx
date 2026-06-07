import * as React from 'react';

import { cn } from './lib/utils';

/**
 * shadcn/ui Skeleton placeholder. Ported during task 60.1.
 *
 * Note: the underlying `animate-pulse` should be wrapped with
 * `motion-safe:` in consumers that opt out of animation under
 * `prefers-reduced-motion: reduce` (Requirement 39.5).
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
