import type { ReactNode } from 'react';

import { AdmissionsNav } from './admissions-nav';

export function AdmissionsChrome({ current, children }: { current: string; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <AdmissionsNav current={current} />
      {children}
    </div>
  );
}
