'use client';

import { Button } from '@proctira/ui/components';

export function PrintReportButton() {
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => window.print()}
      data-testid="print-school-report"
    >
      Print
    </Button>
  );
}
