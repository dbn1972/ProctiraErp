'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import {
  clearAllInstitutionFormDirty,
  requestLeaveConfirm,
} from '@/components/institutions/institution-unsaved-guard';

/**
 * Shared "Back to institutions" control.
 *
 * Rendered as a button (not an anchor) so there is no native navigation fallback
 * that can race past the unsaved-changes prompt. Disabled until client handlers
 * mount so Playwright does not click a dead SSR shell.
 */
export function InstitutionBackLink() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ms-2 w-fit !h-8 !min-h-8 !min-w-0 !gap-1.5 !px-2 !text-xs"
      data-testid="institution-back-link"
      data-ready={ready ? 'true' : 'false'}
      disabled={!ready}
      onClick={() => {
        void (async () => {
          if (!(await requestLeaveConfirm())) return;
          clearAllInstitutionFormDirty();
          router.push('/institutions');
        })();
      }}
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      Back to institutions
    </Button>
  );
}
