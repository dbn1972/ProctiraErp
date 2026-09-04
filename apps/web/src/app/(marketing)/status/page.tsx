import {
  MarketingCtaBand,
  MarketingDocumentTitle,
  MarketingSection,
  MarketingSectionHeading,
} from '@/features/marketing/sections/MarketingStaticChrome';

const COMPONENTS = [
  { name: 'Web app', detail: 'Primary application surface', uptime: '100%' },
  { name: 'API', detail: 'Gateway and domain services', uptime: '99.98%' },
  {
    name: 'Authentication',
    detail: 'SSO, OTP & sessions',
    uptime: '100%',
  },
  {
    name: 'SMS notifications',
    detail: 'Guardian alerts & OTP delivery',
    uptime: '99.91%',
  },
  {
    name: 'Integrations',
    detail: 'Disbursal & reconciliation connectors',
    uptime: '99.95%',
  },
  {
    name: 'Reports engine',
    detail: 'Exports, PDFs & statutory files',
    uptime: '99.93%',
  },
] as const;

const INCIDENTS = [
  {
    title: 'Delayed SMS delivery to guardians in eastern districts',
    when: '22 May 2026 · 14:05–16:40 IST',
    body: 'A telecom gateway partner experienced congestion that delayed roughly 38% of attendance-alert SMS by 30–90 minutes. No messages were lost; queued alerts were delivered after automatic failover to the secondary gateway. Failover threshold was lowered from 10 minutes to 3 minutes.',
    meta: 'Duration 2h 35m · Impact: degraded · Affected: SMS notifications',
  },
  {
    title: 'Elevated API latency during term-end report generation',
    when: '28 March 2026 · 10:12–11:48 IST',
    body: 'Concurrent report-card generation across 140+ schools at term close saturated the reports queue and raised p95 API latency. Report workloads were isolated onto a dedicated worker pool with pre-term capacity scheduling. No data was affected and no requests failed.',
    meta: 'Duration 1h 36m · Impact: degraded · Affected: API, Reports engine',
  },
] as const;

/**
 * System status — App Router page sourced from redesign/website/status.html.
 */
export default function StatusPage() {
  return (
    <>
      <MarketingDocumentTitle pageTitle="System status" />
      <main
        data-testid="marketing-status-page"
        className="flex flex-1 flex-col"
      >
        <section className="border-b border-border bg-[hsl(var(--secondary))]">
          <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-20 lg:px-8 lg:py-24">
            <span className="inline-flex items-center gap-2 rounded-md bg-background px-3 py-1.5 text-sm font-medium text-foreground">
              <span
                className="h-2 w-2 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              All systems operational
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              System status
            </h1>
            <p className="mt-4 max-w-3xl text-lg text-muted-foreground">
              Live operational state of ProctiraERP cloud services. Component
              health below reflects the latest published snapshot for the
              managed cloud edition.
            </p>
          </div>
        </section>

        <MarketingSection>
          <div className="overflow-hidden rounded-lg border border-border">
            <ul className="divide-y divide-border" role="list">
              {COMPONENTS.map((component) => (
                <li
                  key={component.name}
                  className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {component.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {component.detail}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Operational
                    </span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {component.uptime}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </MarketingSection>

        <MarketingSection alt>
          <MarketingSectionHeading
            kicker="History"
            title="Past incidents"
            subtitle="Post-mortems and corrective actions are published with every incident affecting a production service."
          />
          <div className="flex flex-col gap-4">
            {INCIDENTS.map((incident) => (
              <article
                key={incident.title}
                className="rounded-lg border border-border bg-background p-6"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    Resolved
                  </span>
                  <h3 className="text-lg font-semibold text-foreground">
                    {incident.title}
                  </h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {incident.when}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {incident.body}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {incident.meta}
                </p>
              </article>
            ))}
          </div>
        </MarketingSection>

        <MarketingCtaBand
          heading="Subscribe to status updates"
          body="Operations teams can receive incident notifications by email — contact us to join the status distribution list."
          primary={{ href: '/contact', label: 'Subscribe to updates' }}
          secondary={{ href: '/security', label: 'How we run operations' }}
        />
      </main>
    </>
  );
}
