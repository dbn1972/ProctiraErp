import Link from 'next/link';

import { Button, Card, CardContent } from '@proctira/ui/components';

import {
  MarketingCtaBand,
  MarketingDocumentTitle,
  MarketingHero,
  MarketingSection,
  MarketingSectionHeading,
} from '@/features/marketing/sections/MarketingStaticChrome';

/**
 * Installation guide — App Router page sourced from redesign/website/installation.html.
 * Path matches marketing footer `Installation → guide` (`/installation`).
 */
export default function InstallationPage() {
  return (
    <>
      <MarketingDocumentTitle pageTitle="Installation" />
      <main
        data-testid="marketing-installation-page"
        className="flex flex-1 flex-col"
      >
        <MarketingHero
          eyebrow="Self-hosting · Apache-2.0"
          heading={
            <>
              Run it <span className="text-primary">yourself</span>
            </>
          }
          lead="ProctiraERP is fully self-hostable on your own infrastructure — your servers, your data centre, your sovereignty. Choose cloud-managed for a turnkey experience, or follow this guide for full control."
        >
          <Button asChild size="lg">
            <Link href="#options">Choose a deployment</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/about">About the project</Link>
          </Button>
        </MarketingHero>

        <MarketingSection>
          <MarketingSectionHeading
            kicker="Before you start"
            title="System requirements"
            subtitle="Sized for a district of ~150 schools and 30,000 students. Smaller pilots run comfortably on half of this."
          />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-[hsl(var(--secondary))] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Component</th>
                  <th className="px-4 py-3 font-medium">Minimum</th>
                  <th className="px-4 py-3 font-medium">Recommended</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  [
                    'Compute',
                    '4 vCPU · 8 GB RAM',
                    '8 vCPU · 16 GB RAM',
                    'Containerized via Docker or Kubernetes',
                  ],
                  [
                    'Database',
                    'PostgreSQL 16+',
                    'PostgreSQL 16 with streaming replica',
                    'Redis 7 required for cache and queues',
                  ],
                  [
                    'Storage',
                    '50 GB SSD',
                    '200 GB SSD + S3-compatible object store',
                    'Documents, photos, and report exports',
                  ],
                  [
                    'Network',
                    'TLS 1.2 termination',
                    'TLS 1.3, reverse proxy, private DB subnet',
                    'Outbound SMS gateway and eKYC access',
                  ],
                  [
                    'Operating system',
                    'Ubuntu 22.04 / Debian 12',
                    'Any OCI-compatible container host',
                    'Air-gapped installs supported',
                  ],
                ].map(([component, min, rec, notes]) => (
                  <tr key={component}>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {component}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{min}</td>
                    <td className="px-4 py-3 text-muted-foreground">{rec}</td>
                    <td className="px-4 py-3 text-muted-foreground">{notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MarketingSection>

        <MarketingSection alt>
          <div id="options" className="scroll-mt-24">
            <MarketingSectionHeading
              kicker="Deployment options"
              title="Four ways to deploy"
              subtitle="From a single-server pilot to a state-scale cluster — pick the path that matches your team."
            />
            <div className="grid gap-6 md:grid-cols-2">
              {[
                {
                  title: 'Docker Compose',
                  badge: 'Fastest start',
                  body: 'Single-server evaluation and small-school production. Web, API, PostgreSQL, and Redis in one stack.',
                },
                {
                  title: 'Kubernetes Helm',
                  badge: 'Production',
                  body: 'HA charts for ministries and large districts with horizontal scaling, pod disruption budgets, and secret injection.',
                },
                {
                  title: 'Managed cloud',
                  badge: 'Turnkey',
                  body: 'We operate the cluster under your tenant branding with SLA-backed uptime, backups, and upgrades.',
                },
                {
                  title: 'Air-gapped bundle',
                  badge: 'Sovereign',
                  body: 'Signed OCI images and offline installers for disconnected data centres and defence networks.',
                },
              ].map((option) => (
                <Card key={option.title} className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 p-6">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-foreground">
                        {option.title}
                      </h3>
                      <span className="rounded-md bg-[hsl(var(--secondary))] px-2 py-1 text-xs font-medium text-muted-foreground">
                        {option.badge}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{option.body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </MarketingSection>

        <MarketingCtaBand
          heading="Need help standing it up?"
          body="Talk to the team about cloud editions, migration from legacy EMIS systems, or a guided self-hosted rollout."
          primary={{ href: '/contact', label: 'Talk to sales' }}
          secondary={{ href: '/demo', label: 'Request a demo' }}
        />
      </main>
    </>
  );
}
