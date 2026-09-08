'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Lock, Send } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import type { AssignmentStatus } from '@/lib/api/lms';

import { closeAssignmentAction, publishAssignmentAction } from '../actions';

export function AssignmentLifecycle({ id, status }: { id: string; status: AssignmentStatus }) {
  const t = useTranslations('lms');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  if (status === 'closed' || status === 'archived') return null;

  function run(action: (id: string) => Promise<{ status: string; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action(id);
      if (result.status === 'error') setError(result.message ?? t('actionFailed'));
      else {
        setConfirmClose(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        {status === 'draft' ? (
          <Button
            size="sm"
            disabled={pending}
            aria-busy={pending}
            onClick={() => run(publishAssignmentAction)}
          >
            <Send className="me-1.5 h-4 w-4" aria-hidden="true" />
            {t('publish')}
          </Button>
        ) : null}
        {status === 'published' && !confirmClose ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setConfirmClose(true)}
          >
            <Lock className="me-1.5 h-4 w-4" aria-hidden="true" />
            {t('close')}
          </Button>
        ) : null}
        {status === 'published' && confirmClose ? (
          <div role="group" aria-label={t('confirmCloseTitle')} className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('confirmCloseBody')}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmClose(false)}
            >
              {t('keepOpen')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              aria-busy={pending}
              onClick={() => run(closeAssignmentAction)}
            >
              {t('confirmClose')}
            </Button>
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
