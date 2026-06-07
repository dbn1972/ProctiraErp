import { useTranslations } from 'next-intl';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { TrackingForm } from '@/components/tracking/tracking-form';

/**
 * Public application status check page.
 *
 * Requires the tracking number AND the student's date of birth — no auth.
 */
export default function TrackPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 lg:px-8">
          <TrackingHeader />
          <div className="mt-8">
            <TrackingForm />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function TrackingHeader() {
  const t = useTranslations('tracking');
  return (
    <div className="text-center">
      <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
      <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>
    </div>
  );
}
