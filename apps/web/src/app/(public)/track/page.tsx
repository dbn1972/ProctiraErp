import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { Loader2 } from 'lucide-react';

import { ApplicationTracking } from './application-tracking';
import { DocumentTitle } from '@/components/DocumentTitle';

/**
 * Public Application Tracking page (Requirement 16.6, 16.11 / Task 51.4).
 * Styled to match redesign/registration/track.html.
 */
export default async function TrackingPage(): Promise<JSX.Element> {
  const t = await getTranslations('tracking');

  return (
    <main className="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-4 py-10 sm:px-6 pb-14">
      <DocumentTitle pageTitle={t('title')} />
      <header className="space-y-1.5 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="text-base text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Suspense
        fallback={
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <ApplicationTracking />
      </Suspense>
    </main>
  );
}
