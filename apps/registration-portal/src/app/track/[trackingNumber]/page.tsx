import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { StatusCard } from '@/components/tracking/status-card';
import { TrackingForm } from '@/components/tracking/tracking-form';
import { checkApplicationStatus } from '@/lib/api';
import { TRACK_DOB_COOKIE } from '@/lib/track-lookup';
import { isValidDateOfBirth, isValidTrackingNumber } from '@/lib/validation';

interface PageProps {
  params: Promise<{ trackingNumber: string }>;
  searchParams: Promise<{ dob?: string }>;
}

/**
 * Application status detail page.
 *
 * The date of birth comes from the httpOnly cookie set by POST /track/lookup.
 * A `dob` query value is stripped and ignored so it is not kept in the address
 * bar, history, or the next page's referrer.
 */
export default async function TrackingDetailPage({ params, searchParams }: PageProps) {
  const t = await getTranslations('tracking');
  const { trackingNumber: rawTrackingNumber } = await params;
  const query = await searchParams;
  const trackingNumber = decodeURIComponent(rawTrackingNumber).toUpperCase();

  if (query.dob) {
    redirect(`/track/${encodeURIComponent(trackingNumber)}`);
  }

  const cookieStore = await cookies();
  const dob = cookieStore.get(TRACK_DOB_COOKIE)?.value ?? '';
  const valid = isValidTrackingNumber(trackingNumber) && isValidDateOfBirth(dob);

  let result: Awaited<ReturnType<typeof checkApplicationStatus>> = null;
  if (valid) {
    try {
      result = await checkApplicationStatus(trackingNumber, dob);
    } catch {
      result = null;
    }
  }

  const isMatch = valid && result !== null;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t('applicationNumber')}
          </p>
          <h1 className="mt-1 font-mono text-2xl font-bold tracking-tight text-gray-900">
            {trackingNumber}
          </h1>

          <div className="mt-8">
            {isMatch && result ? (
              <StatusCard status={result} />
            ) : (
              <div className="space-y-6">
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  {t('notFound')}
                </div>
                <TrackingForm />
                <div className="text-center">
                  <Link href="/track" className="text-sm text-primary-700 hover:underline">
                    {t('checkStatus')}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
