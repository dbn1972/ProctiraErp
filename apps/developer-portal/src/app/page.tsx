import Link from 'next/link';

/**
 * Developer Portal landing/home page (v2.0 redesign).
 *
 * Developer-focused presentation: bold hero with primary CTAs, an example
 * API request code sample, capability/quick-start cards, and a getting-started
 * walkthrough. Uses this app's Tailwind tokens (primary/accent) and inline
 * SVG icons (lucide-react is not a dependency of this app).
 */

const ArrowRight = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

type Feature = {
  title: string;
  description: string;
  linkLabel: string;
  href: string;
  icon: JSX.Element;
};

const features: Feature[] = [
  {
    title: 'REST API',
    description:
      '240+ versioned endpoints with cursor pagination, idempotency keys, and predictable errors. OpenAPI 3.1 spec included.',
    linkLabel: 'API reference',
    href: '/docs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    title: 'Plugin SDK',
    description:
      'TypeScript SDK with typed entities, UI slots, and a local dev server. Scaffold to publish in under an hour.',
    linkLabel: 'SDK guide',
    href: '/docs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </svg>
    ),
  },
  {
    title: 'Webhooks',
    description:
      'Signed events for every state change — admissions, attendance, results. At-least-once delivery with automatic retries.',
    linkLabel: 'Event catalog',
    href: '/docs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    title: 'Sandbox tenants',
    description:
      'Spin up a disposable school pre-seeded with realistic demo data. Reset anytime, no production risk.',
    linkLabel: 'Create sandbox',
    href: '/dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    title: 'Theme kit',
    description:
      'Design tokens, components, and dark mode out of the box — your plugin looks native in every tenant’s branding.',
    linkLabel: 'Theme docs',
    href: '/docs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="13.5" cy="6.5" r="2.5" />
        <circle cx="19" cy="13" r="2.5" />
        <circle cx="6" cy="12" r="2.5" />
        <circle cx="10" cy="19.5" r="2.5" />
        <path d="M12 9a9 9 0 0 0-7 7m14-1a9 9 0 0 0-5-8m-3 12a9 9 0 0 0 7-4" />
      </svg>
    ),
  },
  {
    title: 'OAuth scopes',
    description:
      'Granular, consent-based scopes down to the field level. Students’ personal data stays protected under DPDP Act 2023.',
    linkLabel: 'Auth guide',
    href: '/docs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
];

const steps = [
  {
    title: 'Create a developer account',
    body: (
      <>
        Sign in with GitHub or email. You get a sandbox tenant{' '}
        <code className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-accent-700">
          sandbox-*-demo
        </code>{' '}
        seeded with demo students automatically.
      </>
    ),
  },
  {
    title: 'Grab your API key',
    body: (
      <>
        Generate a scoped key from the dashboard and export it as{' '}
        <code className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-accent-700">
          PROCTIRA_API_KEY
        </code>
        . Keys rotate without downtime.
      </>
    ),
  },
  {
    title: 'Make your first request',
    body: (
      <>
        Run the quickstart request above, or{' '}
        <code className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-accent-700">
          npx create-proctira-plugin
        </code>{' '}
        to scaffold a full plugin with hot reload.
      </>
    ),
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2.5 text-gray-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-base font-extrabold text-white shadow-inner">
              P
            </span>
            <span className="text-base font-bold tracking-tight">
              Proctira<span className="text-primary-600">ERP</span>
            </span>
            <span className="ml-0.5 rounded-md border border-gray-200 bg-primary-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-700">
              Developers
            </span>
          </Link>
          <nav className="hidden gap-1 md:flex" aria-label="Main">
            <Link href="/docs" className="rounded-md px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900">
              Docs
            </Link>
            <Link href="/docs" className="rounded-md px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900">
              API Reference
            </Link>
            <Link href="/marketplace" className="rounded-md px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900">
              Plugins
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <Link
              href="/dashboard"
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
            >
              Get API key
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-gray-200 bg-white">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
            <div>
              <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden="true" />
                API v3 is live · sandbox tenants now self-serve
              </span>
              <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
                Build for{' '}
                <span className="bg-gradient-to-r from-primary-500 to-accent-500 bg-clip-text text-transparent">
                  every school in India
                </span>
              </h1>
              <p className="mb-7 max-w-xl text-lg leading-relaxed text-gray-600">
                One REST API across enrollment, attendance, assessments, and
                scholarships. Ship a plugin once and it runs in every
                ProctiraERP school — from a single classroom to an entire state.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
                >
                  Get API key
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/docs"
                  className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100"
                >
                  Read the docs
                </Link>
              </div>
            </div>

            {/* Code sample */}
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-[#0A1020] shadow-lg">
              <div className="flex items-center gap-2 border-b border-white/10 bg-[#111a30] px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#F87171]" aria-hidden="true" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#FBBF24]" aria-hidden="true" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#34D399]" aria-hidden="true" />
                <span className="ml-2 font-mono text-[11px] text-gray-400">quickstart.sh</span>
                <span className="ml-auto text-[11px] font-bold uppercase tracking-wider text-gray-500">curl</span>
              </div>
              <pre className="overflow-x-auto px-5 py-4 font-mono text-xs leading-relaxed text-[#C6D0E8]" aria-label="Example API request">
{`# List students enrolled this week in your sandbox tenant
curl "https://api.proctira.dev/v3/students" \\
  -H "Authorization: Bearer $PROCTIRA_API_KEY" \\
  -H "X-Tenant: sandbox-demo" \\
  --data-urlencode "enrolled_after=2026-06-01"

# 200 OK
{
  "data": [{
    "id": "stu_8Hq2vKp",
    "name": "Ananya Pradhan",
    "grade": 1
  }],
  "total": 38
}`}
              </pre>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-6 py-16" id="api">
          <div className="mb-9 max-w-xl">
            <h2 className="mb-2 text-3xl font-extrabold tracking-tight text-gray-900">
              Everything you need to ship
            </h2>
            <p className="text-gray-600">
              The same primitives our own apps are built on — no private APIs,
              no second-class access.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-xl border border-gray-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-primary-500"
              >
                <span className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600 [&_svg]:h-5 [&_svg]:w-5">
                  {f.icon}
                </span>
                <h3 className="mb-1.5 text-lg font-bold text-gray-900">{f.title}</h3>
                <p className="text-sm leading-relaxed text-gray-600">{f.description}</p>
                <Link
                  href={f.href}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  {f.linkLabel}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* Getting started */}
        <section className="border-y border-gray-200 bg-white" id="docs">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="mb-9 max-w-xl">
              <h2 className="mb-2 text-3xl font-extrabold tracking-tight text-gray-900">
                From zero to first call in 5 minutes
              </h2>
              <p className="text-gray-600">
                No sales call, no approval queue. Production access is reviewed
                only when you’re ready to publish.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {steps.map((step, i) => (
                <div key={step.title} className="rounded-xl border border-gray-200 bg-gray-50 p-6">
                  <span className="mb-3.5 flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-sm font-extrabold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mb-1.5 text-base font-bold text-gray-900">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-gray-600">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-7 px-6 py-10 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <Link href="/" className="flex items-center gap-2.5 text-gray-900">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-base font-extrabold text-white">
                P
              </span>
              <span className="text-base font-bold tracking-tight">
                Proctira<span className="text-primary-600">ERP</span>
              </span>
            </Link>
            <p className="mt-2.5 max-w-[36ch] text-sm leading-relaxed text-gray-500">
              The developer platform for India’s school ERP. Build once, run in
              every school.
            </p>
          </div>
          <div>
            <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Documentation
            </h4>
            <div className="flex flex-col gap-2.5 text-sm">
              <Link href="/docs" className="text-gray-600 hover:text-gray-900">Quickstart</Link>
              <Link href="/docs" className="text-gray-600 hover:text-gray-900">API Reference</Link>
              <Link href="/docs" className="text-gray-600 hover:text-gray-900">Webhooks</Link>
              <Link href="/docs" className="text-gray-600 hover:text-gray-900">Plugin SDK</Link>
            </div>
          </div>
          <div>
            <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Platform
            </h4>
            <div className="flex flex-col gap-2.5 text-sm">
              <Link href="/marketplace" className="text-gray-600 hover:text-gray-900">Plugin marketplace</Link>
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">Sandbox tenants</Link>
              <Link href="/docs" className="text-gray-600 hover:text-gray-900">Changelog</Link>
              <Link href="/docs" className="text-gray-600 hover:text-gray-900">Rate limits</Link>
            </div>
          </div>
          <div>
            <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Support
            </h4>
            <div className="flex flex-col gap-2.5 text-sm">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">System status</Link>
              <Link href="/docs" className="text-gray-600 hover:text-gray-900">Developer forum</Link>
              <Link href="/docs" className="text-gray-600 hover:text-gray-900">Report a vulnerability</Link>
              <Link href="/docs" className="text-gray-600 hover:text-gray-900">API terms</Link>
            </div>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 border-t border-gray-200 px-6 py-5 text-xs text-gray-500">
          <span>© 2026 ProctiraERP · Developer Portal</span>
          <span className="ml-auto inline-flex items-center gap-2 font-semibold text-accent-600">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden="true" />
            All systems operational
          </span>
        </div>
      </footer>
    </div>
  );
}
