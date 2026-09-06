import type { Metadata } from 'next';
import Link from 'next/link';

import { ApiKeyDemoForm } from './api-key-demo-form';

export const metadata: Metadata = {
  title: 'Developer Dashboard',
  description: 'API key request demo and sandbox guidance for platform developers.',
};

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16" data-testid="developer-dashboard-page">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary-700">Workspace</p>
      <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-gray-900">
        Developer dashboard
      </h1>
      <p className="mb-4 max-w-2xl text-base leading-relaxed text-gray-600">
        Request API keys and review sandbox guidance. Key minting against a live developer IdP is
        not wired in this build — the form below validates client-side only.
      </p>

      <div
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        data-testid="dashboard-honesty-banner"
      >
        Honesty mode: no sandbox tenant or API key is created until the developer auth service is
        connected.
      </div>

      <ApiKeyDemoForm />

      <p className="mt-8 text-sm text-gray-500">
        Browse{' '}
        <Link href="/docs" className="font-semibold text-primary-700 hover:underline">
          documentation
        </Link>{' '}
        or the{' '}
        <Link href="/marketplace" className="font-semibold text-primary-700 hover:underline">
          plugin marketplace
        </Link>
        .
      </p>
    </main>
  );
}
