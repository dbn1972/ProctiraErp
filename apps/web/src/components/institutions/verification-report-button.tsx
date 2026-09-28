'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';

import { Button } from '@proctira/ui/components';

export function VerificationReportButton({ institutionId }: { institutionId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        data-testid="infrastructure-verification-report"
        onClick={() => {
          setPending(true);
          setError(null);
          void (async () => {
            try {
              const response = await fetch(
                `/api/institutions/${institutionId}/infrastructure/report`,
                { cache: 'no-store' },
              );
              if (!response.ok) {
                setError('The verification report could not be generated. Try again.');
                return;
              }
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `facility-verification-${institutionId}.csv`;
              link.click();
              URL.revokeObjectURL(url);
            } catch {
              setError('The verification report could not be generated. Try again.');
            } finally {
              setPending(false);
            }
          })();
        }}
      >
        <FileText className="me-1.5 h-4 w-4" aria-hidden="true" />
        {pending ? 'Preparing report…' : 'Verification report (.csv)'}
      </Button>
      {error ? (
        <p
          className="text-xs text-destructive"
          role="alert"
          data-testid="verification-report-error"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
