import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'System status',
  description:
    'Operational status of ProctiraERP public services. Subscribe for incident updates.',
  alternates: { canonical: '/status' },
};

const SERVICES = [
  { name: 'Web app', detail: 'app.proctira.org' },
  { name: 'API', detail: 'api.proctira.org' },
  { name: 'Authentication', detail: 'SSO, OTP & sessions' },
  { name: 'SMS notifications', detail: 'Guardian alerts & OTP delivery' },
  { name: 'DBT integration', detail: 'Disbursal & reconciliation' },
  { name: 'Reports engine', detail: 'Exports, PDFs & data files' },
];

/**
 * Status page.
 *
 * Presents an overall operational banner and a per-service list. Operators
 * should wire this to their incident-management platform (Statuspage,
 * Instatus, etc.) before public launch; the static layout here is sufficient
 * for development and pre-launch environments and avoids implying live
 * uptime metrics that are not measured here.
 */
export default function StatusPage() {
  return (
    <>
      {/* Status hero */}
      <section
        className="border-b border-border bg-gradient-to-b from-secondary/60 to-background"
        aria-labelledby="status-heading"
      >
        <div className="container py-16 text-center md:py-20">
          <span className="inline-flex items-center gap-2.5 rounded-full border border-accent/40 bg-accent/10 px-5 py-2.5 text-base font-bold text-accent">
            <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
            All systems operational
          </span>
          <h1
            id="status-heading"
            className="mt-6 text-4xl font-extrabold tracking-tight text-foreground md:text-5xl"
          >
            System status
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            The current operational state of ProctiraERP cloud services.
            Operators should connect this page to their status provider for
            live data.
          </p>
        </div>
      </section>

      {/* Component status */}
      <section className="container py-16" aria-label="Component status">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Operational status of ProctiraERP components
            </caption>
            <tbody>
              {SERVICES.map((service) => (
                <tr
                  key={service.name}
                  className="border-b border-border last:border-b-0"
                >
                  <th scope="row" className="px-6 py-5 align-top">
                    <span className="block font-semibold text-foreground">
                      {service.name}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {service.detail}
                    </span>
                  </th>
                  <td className="px-6 py-5 text-right">
                    <span className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full bg-accent"
                      />
                      Operational
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Incident history */}
      <section
        className="border-t border-border bg-secondary/30 py-16"
        aria-labelledby="history-heading"
      >
        <div className="container max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
            History
          </p>
          <h2
            id="history-heading"
            className="mt-3 text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            Past incidents
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Post-mortems and corrective actions are published with every
            incident affecting a production service.
          </p>
          <div className="mt-8 rounded-2xl border border-border bg-card p-8 text-center">
            <CheckCircle2
              aria-hidden="true"
              className="mx-auto h-8 w-8 text-accent"
            />
            <p className="mt-3 font-semibold text-foreground">
              No incidents reported.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              When this page is connected to a status provider, resolved
              incidents and their post-mortems will appear here.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="status-cta-heading"
      >
        <div className="container py-20 text-center">
          <h2
            id="status-cta-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Subscribe to status updates
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            Operations teams can receive incident notifications by email, RSS,
            or webhook — straight from status.proctira.org.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/contact">Subscribe to updates</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/security">How we run operations</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
