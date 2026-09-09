import type { ReactNode } from 'react';

import { AdmissionsNav } from './admissions-nav';

export function AdmissionsChrome({
  title,
  description,
  current,
  children,
}: {
  title: string;
  description: string;
  current: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <AdmissionsNav current={current} />
      {children}
    </div>
  );
}
