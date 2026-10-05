import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { StatusCard } from '@/components/tracking/status-card';
import { TrackingForm } from '@/components/tracking/tracking-form';
import { checkApplicationStatus } from '@/lib/api';
import { serverTransport } from '@/lib/gateway';
import {
  resolveTrackingPage,
  safeDecodeTrackingNumber,
  TRACK_DOB_COOKIE,
} from '@/lib/track-lookup';

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
  const decoded = safeDecodeTrackingNumber(rawTrackingNumber);
  if (query.dob && decoded) {
    redirect(`/track/${encodeURIComponent(decoded)}`);
  }
  const cookieStore = await cookies();
  const dob = cookieStore.get(TRACK_DOB_COOKIE)?.value ?? '';
  // PRC-M055: outage / throttle / malformed URL are distinct from "not found".
  const state = await resolveTrackingPage(rawTrackingNumber, dob, (tn, d) =>
    checkApplicationStatus(tn, d, serverTransport),
  );
  const trackingNumber = state.trackingNumber ?? '';

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
            {state.kind === 'match' ? (
              <StatusCard status={state.status} />
            ) : state.kind === 'unavailable' || state.kind === 'rate_limited' ? (
              <div className="space-y-6">
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
                >
                  {t(state.kind === 'unavailable' ? 'serviceUnavailable' : 'rateLimited')}
                </div>
                <div className="text-center">
                  <Link
                    href={`/track/${encodeURIComponent(trackingNumber)}`}
                    className="btn-secondary"
                  >
                    {t('retry')}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div
                  role="status"
                  className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
                >
                  {t(state.kind === 'invalid' ? 'invalidRequest' : 'notFound')}
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
