import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketplaceCatalog } from './marketplace-catalog';

export const metadata: Metadata = {
  title: 'Plugin Marketplace — Developers',
  description:
    'Browse a static plugin catalog. Install and publish require a live marketplace service.',
};

export default function MarketplacePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16" data-testid="marketplace-page">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary-700">Ecosystem</p>
      <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-gray-900">
        Plugin marketplace
      </h1>
      <p className="mb-4 max-w-2xl text-base leading-relaxed text-gray-600">
        Browse curated extension packages. This catalog is a static fixture for portal UX — install,
        billing, and publisher flows are not connected.
      </p>

      <div
        className="mb-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        data-testid="marketplace-honesty-banner"
      >
        Honesty mode: listings below are demo fixtures. Install buttons stay disabled until a
        marketplace service is wired.
      </div>

      <MarketplaceCatalog />

      <p className="mt-10 text-sm text-gray-500">
        Building a plugin? Start with the{' '}
        <Link href="/docs#plugins" className="font-semibold text-primary-700 hover:underline">
          Plugin SDK notes
        </Link>
        .
      </p>
    </main>
  );
}
