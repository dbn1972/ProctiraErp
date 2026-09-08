import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, Boxes, Cloud, Code2, Layers, Server } from 'lucide-react';

import { PageHero } from '@/components/layout/page-hero';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Installation and developer resources',
  description:
    'Deployment options for ProctiraERP — Docker Compose, Kubernetes Helm, managed cloud, and bare metal — plus system requirements and developer resources.',
  alternates: { canonical: '/installation' },
};

const REQUIREMENTS: ReadonlyArray<{
  component: string;
  minimum: string;
  recommended: string;
  notes: string;
}> = [
  {
    component: 'Compute',
    minimum: '4 vCPU · 8 GB RAM',
    recommended: '8 vCPU · 16 GB RAM',
    notes: 'Containerized via Docker or Kubernetes',
  },
  {
    component: 'Database',
    minimum: 'PostgreSQL 16+',
    recommended: 'PostgreSQL 16 with streaming replica',
    notes: 'Redis 7 required for cache and queues',
  },
  {
    component: 'Storage',
    minimum: '50 GB SSD',
    recommended: '200 GB SSD + S3-compatible object store',
    notes: 'Documents, photos, and report exports',
  },
  {
    component: 'Network',
    minimum: 'TLS 1.2 termination',
    recommended: 'TLS 1.3, reverse proxy, private DB subnet',
    notes: 'Outbound SMS gateway and eKYC access',
  },
  {
    component: 'Operating system',
    minimum: 'Ubuntu 22.04 / Debian 12',
    recommended: 'Any OCI-compatible container host',
    notes: 'Air-gapped installs supported',
  },
];

interface DeployOption {
  readonly icon: typeof Boxes;
  readonly title: string;
  readonly badge: string;
  readonly description: string;
  readonly code: string;
}

const OPTIONS: ReadonlyArray<DeployOption> = [
  {
    icon: Boxes,
    title: 'Docker Compose',
    badge: 'Fastest start',
    description:
      'Single-server evaluation and small-school production. Everything — web, API, PostgreSQL, Redis — in one stack.',
    code: `# Clone and boot the full stack
$ git clone https://github.com/proctira/proctira-erp.git
$ cd proctira-erp
$ cp .env.example .env
$ docker compose up -d`,
  },
  {
    icon: Layers,
    title: 'Kubernetes Helm',
    badge: 'District & state scale',
    description:
      'Production-grade, horizontally scalable deployment with managed PostgreSQL and Redis. HPA, PodDisruptionBudgets, and probes included.',
    code: `$ helm repo add proctira https://charts.proctira.org
$ helm install erp proctira/proctira-erp \\
    --namespace education --create-namespace \\
    --set tenancy.mode="multi"`,
  },
  {
    icon: Cloud,
    title: 'Managed cloud',
    badge: 'Zero ops',
    description:
      'We run upgrades, backups, and monitoring; you keep admin control and your chosen data residency. SLA-backed for ministries.',
    code: `# No installation required — request a tenant
# and receive your workspace shortly:

  https://cloud.proctira.org/request`,
  },
  {
    icon: Server,
    title: 'Bare metal',
    badge: 'Air-gapped ready',
    description:
      'For data centres without container platforms, or fully offline installations in restricted networks.',
    code: `$ curl -fsSL https://get.proctira.org | sudo bash
$ proctira setup --offline-bundle ./erp-bundle.tar
$ proctira migrate && proctira start`,
  },
];

const DEVELOPER_RESOURCES: ReadonlyArray<{
  id?: string;
  icon: typeof BookOpen;
  title: string;
  body: string;
}> = [
  {
    icon: BookOpen,
    title: 'Documentation',
    body: 'Architecture overview, deployment guides, and operations runbooks. Updated with every release.',
  },
  {
    id: 'api',
    icon: Code2,
    title: 'API reference',
    body: 'OpenAPI-described endpoints with permission requirements, rate limits, and example payloads.',
  },
  {
    id: 'sdk',
    icon: Code2,
    title: 'Plugin SDK',
    body: 'Build signed plugins, custom themes, and event handlers without forking the platform.',
  },
];

function CodeCard({ code }: { code: string }) {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-primary-foreground/10 bg-primary text-primary-foreground shadow-md">
      <div className="flex items-center gap-2 border-b border-primary-foreground/10 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-accent/70" />
        <span className="ml-2 text-[0.65rem] font-semibold uppercase tracking-wider text-primary-foreground/50">
          terminal
        </span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-xs leading-relaxed text-primary-foreground/85">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Installation and developer resources hub.
 *
 * System requirements table, four deployment options with code samples, an
 * architecture overview, developer-resource cards (with #api and #sdk
 * anchors used by the footer), and a navy call-to-action.
 */
export default function InstallationPage() {
  return (
    <>
      <PageHero
        eyebrow="Self-hosting · Apache-2.0"
        title="Run it yourself"
        description="ProctiraERP is fully self-hostable on your own infrastructure — your servers, your data centre, your sovereignty. Choose cloud-managed for a turnkey experience, or follow this guide for full control."
      />

      <section className="border-b border-border bg-background">
        <div className="container flex flex-wrap gap-3 py-5">
          <Button asChild size="lg">
            <Link href="#options">Choose a deployment</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/about#opensource">Browse the source on GitHub</Link>
          </Button>
        </div>
      </section>

      {/* Requirements */}
      <section
        id="requirements"
        className="container py-20"
        aria-labelledby="requirements-heading"
        style={{ scrollMarginTop: '5rem' }}
      >
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
          Before you start
        </p>
        <h2
          id="requirements-heading"
          className="mt-3 text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
        >
          System requirements
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          Sized for a mid-size district deployment. Smaller pilots run comfortably on a fraction of
          this.
        </p>
        <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-secondary/50">
              <tr>
                <th className="px-5 py-3 font-semibold text-foreground">Component</th>
                <th className="px-5 py-3 font-semibold text-foreground">Minimum</th>
                <th className="px-5 py-3 font-semibold text-foreground">Recommended</th>
                <th className="px-5 py-3 font-semibold text-foreground">Notes</th>
              </tr>
            </thead>
            <tbody>
              {REQUIREMENTS.map((row) => (
                <tr key={row.component} className="border-b border-border last:border-b-0">
                  <td className="px-5 py-4 font-semibold text-foreground">{row.component}</td>
                  <td className="px-5 py-4 text-muted-foreground">{row.minimum}</td>
                  <td className="px-5 py-4 text-muted-foreground">{row.recommended}</td>
                  <td className="px-5 py-4 text-muted-foreground">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Deployment options */}
      <section
        id="options"
        className="border-t border-border bg-secondary/30 py-20"
        aria-labelledby="options-heading"
        style={{ scrollMarginTop: '5rem' }}
      >
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
              Deployment options
            </p>
            <h2
              id="options-heading"
              className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
            >
              Four ways to deploy
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              From a single-server pilot to a state-scale cluster — pick the path that matches your
              team.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Card key={option.title} className="p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <h3 className="text-lg font-bold tracking-tight text-foreground">
                      {option.title}
                    </h3>
                    <span className="ml-auto rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
                      {option.badge}
                    </span>
                  </div>
                  <p className="mt-3 leading-relaxed text-muted-foreground">{option.description}</p>
                  <CodeCard code={option.code} />
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section
        id="architecture"
        className="container py-20"
        aria-labelledby="architecture-heading"
        style={{ scrollMarginTop: '5rem' }}
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Under the hood
          </p>
          <h2
            id="architecture-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            A boring, dependable architecture
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Stateless web and API layers in front of PostgreSQL, Redis, and a background queue.
            Nothing exotic — by design.
          </p>
        </div>
        <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: 'Browsers & devices', sub: 'teachers · admins · parents' },
            { label: 'Web app', sub: 'Next.js · SSR · PWA' },
            { label: 'API', sub: 'Fastify · REST + webhooks' },
            { label: 'PostgreSQL', sub: 'system of record' },
            { label: 'Redis & queue', sub: 'cache · jobs · sync' },
          ].map((node) => (
            <div
              key={node.label}
              className="rounded-xl border border-border bg-card p-4 text-center shadow-sm"
            >
              <p className="text-sm font-bold text-foreground">{node.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{node.sub}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Button asChild variant="outline" size="lg">
            <Link href="/about#opensource">
              Read the full deployment docs
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Developer resources */}
      <section
        className="border-t border-border bg-secondary/30 py-20"
        aria-labelledby="developers-heading"
      >
        <div className="container">
          <h2
            id="developers-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            For developers
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {DEVELOPER_RESOURCES.map((resource) => {
              const Icon = resource.icon;
              return (
                <Card
                  key={resource.title}
                  id={resource.id}
                  style={resource.id ? { scrollMarginTop: '5rem' } : undefined}
                >
                  <CardHeader>
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <CardTitle className="mt-4">{resource.title}</CardTitle>
                    <CardDescription>{resource.body}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="installation-cta-heading"
      >
        <div className="container py-20 text-center">
          <h2
            id="installation-cta-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Need help with a large rollout?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            Our deployment engineers can take a district from kick-off to live attendance. We can do
            the same for you.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/contact">Talk to deployment engineering</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/status">Check platform status</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
