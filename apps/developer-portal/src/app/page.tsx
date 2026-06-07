import Link from 'next/link';

/**
 * Developer Portal landing page - redirects to dashboard or shows overview.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="mb-4 text-4xl font-bold text-primary-700">
          ProctiraERP Developer Portal
        </h1>
        <p className="mb-8 text-lg text-gray-600">
          Build integrations, plugins, and extensions for the ProctiraERP education
          management platform.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/dashboard"
            className="rounded-lg bg-primary-600 px-6 py-3 text-white hover:bg-primary-700 transition-colors"
          >
            Go to Dashboard
          </Link>
          <Link
            href="/docs"
            className="rounded-lg border border-primary-600 px-6 py-3 text-primary-600 hover:bg-primary-50 transition-colors"
          >
            View Documentation
          </Link>
          <Link
            href="/marketplace"
            className="rounded-lg border border-gray-300 px-6 py-3 text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Browse Marketplace
          </Link>
        </div>
      </div>
    </div>
  );
}
