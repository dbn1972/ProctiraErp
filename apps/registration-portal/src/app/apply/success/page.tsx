import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { SuccessCard } from './success-card';

/**
 * Success page after a registration submission.
 *
 * Reads the tracking number from sessionStorage (the success-card client
 * component) and displays it prominently with a CTA to the tracking page.
 */
export default function ApplySuccessPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
          <SuccessCard />
        </div>
      </main>
      <Footer />
    </div>
  );
}
