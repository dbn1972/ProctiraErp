import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { TrackingForm } from '@/components/tracking/tracking-form';

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

/**
 * Public application status check page.
 *
 * Requires the tracking number AND the student's date of birth — no auth.
 * The date is posted to `/track/lookup` and is not added to the URL.
 */
export default async function TrackPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const t = await getTranslations('tracking');
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">{t('title')}</h1>
            <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>
          </div>
          <div className="mt-8">
            <TrackingForm invalidSubmission={query.error === 'invalid'} />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
