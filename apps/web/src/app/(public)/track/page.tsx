import { getTranslations } from 'next-intl/server';

import { ApplicationTracking } from './application-tracking';
import { DocumentTitle } from '@/components/DocumentTitle';

/**
 * Public Application Tracking page (Requirement 16.6, 16.11 / Task 51.4).
 *
 * Anonymous-accessible. The form lives in the client component below; this
 * server component only renders the page chrome and the localized headings
 * so the first paint is meaningful even before the JS bundle loads.
 *
 * `<DocumentTitle>` (Task 57.2) sets `document.title` to the tenant's
 * configured template once the brand boot fetch resolves, so the browser
 * tab carries the active Brand_Name without any literal in source.
 */
export default async function TrackingPage(): Promise<JSX.Element> {
  const t = await getTranslations('tracking');

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <DocumentTitle pageTitle={t('title')} />
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <ApplicationTracking />
    </main>
  );
}
