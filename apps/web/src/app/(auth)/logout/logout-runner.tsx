'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { signOut } from '@/lib/auth/session';

/**
 * Runs `signOut()` (POST + CSRF header) once on mount. The button is the
 * manual retry if the automatic navigation is interrupted.
 */
export function LogoutRunner() {
  const t = useTranslations();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void signOut('/login');
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold">{t('auth.logout')}</h1>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
      <button
        type="button"
        className="rounded-md border px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={() => void signOut('/login')}
      >
        {t('auth.logout')}
      </button>
    </main>
  );
}
