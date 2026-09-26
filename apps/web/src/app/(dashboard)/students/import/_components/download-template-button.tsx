'use client';

import { Download } from 'lucide-react';

import { Button } from '@proctira/ui/components';

/**
 * Downloads the Excel template from the route handler.
 * The handler is `route.ts`, not a `page.tsx`, so it is not an App Router page link.
 */
export function DownloadTemplateButton() {
  async function onDownload() {
    const response = await fetch('/students/import/template');
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'students-import-template.xlsx';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void onDownload()}>
      <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
      Download template
    </Button>
  );
}
