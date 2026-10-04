'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@proctira/ui/components';
/**
 * Downloads the Excel template from the route handler.
 * The handler is `route.ts`, not a `page.tsx`, so it is not an App Router page link.
 * Failures are surfaced (PRC-L058) instead of silently doing nothing.
 */
export function DownloadTemplateButton() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function onDownload() {
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      const response = await fetch('/students/import/template');
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? 'You are not allowed to download the import template. Sign in again or ask an administrator.'
            : `The import template could not be downloaded (HTTP ${response.status}). Try again.`,
        );
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'students-import-template.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('Template downloaded.');
    } catch {
      setError('The import template could not be downloaded. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void onDownload()}
      >
        <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
        {pending ? 'Downloading…' : 'Download template'}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
