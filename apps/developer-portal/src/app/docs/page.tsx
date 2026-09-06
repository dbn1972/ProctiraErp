import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Documentation — Developers',
  description: 'Developer documentation index: quickstart, REST, webhooks, and plugin SDK.',
};

const SECTIONS = [
  {
    id: 'quickstart',
    title: 'Quickstart',
    body: 'Authenticate with a bearer token, set X-Tenant-ID, and call versioned REST endpoints under /api/v1.',
  },
  {
    id: 'rest',
    title: 'REST overview',
    body: 'Cursor pagination, idempotency keys on writes, and structured error envelopes. OpenAPI is published with each gateway release.',
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    body: 'Signed HTTPS callbacks for admissions, attendance, and results. Retries use exponential backoff with at-least-once delivery.',
  },
  {
    id: 'plugins',
    title: 'Plugin SDK',
    body: 'TypeScript SDK with typed entities and UI slots. Scaffold locally, then submit a signed package for review.',
  },
  {
    id: 'limits',
    title: 'Rate limits',
    body: 'Default sandbox budgets are 60 requests/minute per key. Production limits are tenant-plan specific.',
  },
] as const;

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16" data-testid="docs-page">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary-700">Reference</p>
      <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-gray-900">Documentation</h1>
      <p className="mb-8 max-w-2xl text-base leading-relaxed text-gray-600">
        Static developer reference for integrating with the education platform APIs. This index is
        published with the portal; it is not a hosted OpenAPI explorer.
      </p>

      <ul className="space-y-4">
        {SECTIONS.map((section) => (
          <li
            key={section.id}
            id={section.id}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-lg font-semibold text-gray-900">{section.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{section.body}</p>
          </li>
        ))}
      </ul>

      <pre
        className="mt-8 overflow-x-auto rounded-xl bg-gray-950 p-4 text-xs leading-relaxed text-gray-100"
        data-testid="docs-sample-curl"
      >
        {`curl -s \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "X-Tenant-ID: $TENANT" \\\n  https://api.example.edu/api/v1/students?limit=25`}
      </pre>

      <p className="mt-8 text-sm text-gray-500">
        Need keys?{' '}
        <Link href="/dashboard" className="font-semibold text-primary-700 hover:underline">
          Open the developer dashboard
        </Link>
        .
      </p>
    </main>
  );
}
