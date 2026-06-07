import type { Metadata } from 'next';
import { CheckCircle2 } from 'lucide-react';

import { PageHero } from '@/components/layout/page-hero';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'System status',
  description:
    'Operational status of ProctiraERP public services. Subscribe for incident updates.',
  alternates: { canonical: '/status' },
};

const SERVICES = [
  { name: 'Public website', status: 'Operational' },
  { name: 'Identity and authentication', status: 'Operational' },
  { name: 'API gateway', status: 'Operational' },
  { name: 'Background processing', status: 'Operational' },
  { name: 'Object storage and exports', status: 'Operational' },
];

/**
 * Status page placeholder.
 *
 * Operators should replace this with a link to their incident-management
 * platform (Statuspage, Instatus, etc.) before public launch. The simple
 * static layout here is sufficient for development and pre-launch
 * environments.
 */
export default function StatusPage() {
  return (
    <>
      <PageHero
        eyebrow="Operations"
        title="System status"
        description="The current operational state of ProctiraERP public services."
      />

      <section className="container py-16" aria-labelledby="status-heading">
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-accent">
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
            <p className="text-sm font-semibold">All systems operational</p>
          </div>
          <p className="mt-1 text-sm">
            Last checked: replace with live data from your status provider.
          </p>
        </div>

        <h2
          id="status-heading"
          className="mt-10 text-2xl font-bold tracking-tight text-foreground"
        >
          Component status
        </h2>
        <div className="mt-6 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Operational status of ProctiraERP components
            </caption>
            <thead className="bg-secondary/60 text-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Component
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {SERVICES.map((service) => (
                <tr key={service.name}>
                  <th scope="row" className="px-4 py-3 font-medium text-foreground">
                    {service.name}
                  </th>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 text-accent">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full bg-accent"
                      />
                      {service.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Subscribe to updates</CardTitle>
              <CardDescription>
                Operators using a hosted status page can replace this section
                with their subscription form (email, RSS, webhook).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Until then, watch{' '}
                <a
                  className="font-medium text-primary hover:underline"
                  href="https://status.proctira.org"
                >
                  status.proctira.org
                </a>{' '}
                for live updates.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Past incidents</CardTitle>
              <CardDescription>
                Incident history, post-mortems, and corrective actions are
                published with each affected service.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>
    </>
  );
}
