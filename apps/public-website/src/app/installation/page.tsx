import type { Metadata } from 'next';
import {
  BookOpen,
  Cloud,
  Code2,
  Cpu,
  Database,
  Server,
} from 'lucide-react';

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
  title: 'Installation and developer resources',
  description:
    'Deployment options for ProctiraERP — cloud-managed and self-hosted — plus links to API reference and the plugin SDK.',
  alternates: { canonical: '/installation' },
};

const REQUIREMENTS = [
  {
    icon: Cpu,
    title: 'Compute',
    body: '4 vCPU and 8 GB RAM for a small deployment; scale horizontally for larger tenants. Containerized via Docker or Kubernetes.',
  },
  {
    icon: Database,
    title: 'Storage',
    body: 'PostgreSQL 14+ or MySQL 8+ for primary data. S3-compatible object storage for documents and exports.',
  },
  {
    icon: Server,
    title: 'Network',
    body: 'TLS termination, reverse proxy (nginx, Traefik, or your CDN), and outbound connectivity for upgrades and email.',
  },
];

/**
 * Installation and developer resources hub.
 */
export default function InstallationPage() {
  return (
    <>
      <PageHero
        eyebrow="Deploy"
        title="Run ProctiraERP your way"
        description="Choose cloud-managed for a turnkey experience, or self-host on your own infrastructure for full control."
      />

      <section className="container py-16" aria-labelledby="options-heading">
        <h2
          id="options-heading"
          className="text-2xl font-bold tracking-tight text-foreground"
        >
          Deployment options
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Cloud aria-hidden="true" className="h-5 w-5" />
              </div>
              <CardTitle className="mt-4">Cloud-managed</CardTitle>
              <CardDescription>
                We handle infrastructure, upgrades, backups, and monitoring.
                Choose your data residency and SSO provider.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Multi-region availability</li>
                <li>SLA-backed availability and support</li>
                <li>Automated upgrades with maintenance windows</li>
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10 text-accent">
                <Server aria-hidden="true" className="h-5 w-5" />
              </div>
              <CardTitle className="mt-4">Self-hosted</CardTitle>
              <CardDescription>
                Deploy on your own infrastructure with our packaging,
                migrations, and runbooks. Cloud-vendor-agnostic.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Docker Compose for evaluation and small sites</li>
                <li>Helm charts for Kubernetes</li>
                <li>Bring your own database, object store, and SSO</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      <section
        id="requirements"
        className="border-t border-border bg-secondary/30 py-16"
        aria-labelledby="requirements-heading"
      >
        <div className="container">
          <h2
            id="requirements-heading"
            className="text-2xl font-bold tracking-tight text-foreground"
          >
            System requirements
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {REQUIREMENTS.map((requirement) => {
              const Icon = requirement.icon;
              return (
                <Card key={requirement.title}>
                  <CardHeader>
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <CardTitle className="mt-4">{requirement.title}</CardTitle>
                    <CardDescription>{requirement.body}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="api"
        className="container py-16"
        aria-labelledby="developers-heading"
      >
        <h2
          id="developers-heading"
          className="text-2xl font-bold tracking-tight text-foreground"
        >
          For developers
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <BookOpen aria-hidden="true" className="h-5 w-5" />
              </div>
              <CardTitle className="mt-4">Documentation</CardTitle>
              <CardDescription>
                Architecture overview, deployment guides, and operations
                runbooks. Updated with every release.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Code2 aria-hidden="true" className="h-5 w-5" />
              </div>
              <CardTitle className="mt-4">API reference</CardTitle>
              <CardDescription>
                OpenAPI-described endpoints with permission requirements,
                rate limits, and example payloads.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card id="sdk">
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10 text-accent">
                <Code2 aria-hidden="true" className="h-5 w-5" />
              </div>
              <CardTitle className="mt-4">Plugin SDK</CardTitle>
              <CardDescription>
                Build signed plugins, custom themes, and event handlers
                without forking the platform.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>
    </>
  );
}
