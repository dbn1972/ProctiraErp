import type { ReactNode } from 'react';

export interface DataTableShellProps {
  toolbar?: ReactNode;
  children: ReactNode;
}

/** Lightweight shell for table + optional toolbar. */
export function DataTableShell({ toolbar, children }: DataTableShellProps) {
  return (
    <div className="space-y-3">
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
      <div className="overflow-x-auto rounded-md border border-border">{children}</div>
    </div>
  );
}
