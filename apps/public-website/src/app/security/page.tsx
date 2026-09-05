import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Clock,
  Lock,
  Mail,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

import { PageHero } from '@/components/layout/page-hero';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'How ProctiraERP protects student, staff, and institutional data: encryption, audit logging, RBAC, data residency, and coordinated vulnerability disclosure.',
  alternates: { canonical: '/security' },
  openGraph: {
    title: 'ProctiraERP Security',
    description: 'Security disclosures for the ProctiraERP platform.',
    url: '/security',
  },
};

const CONTROLS = [
  {
    icon: Lock,
    title: 'Encryption at rest & in transit',
    body: 'TLS 1.2+ everywhere and AES-256 at rest. Centralized secret management with automatic rotation and least-privilege access to keys.',
  },
  {
    icon: Users,
    title: 'RBAC & audit logs',
    body: 'Fine-grained, role-based permissions per module and field. Every read of sensitive student data and every write is recorded in an immutable audit trail.',
  },
  {
    icon: Clock,
    title: 'Configurable data residency',
    body: 'Cloud tenants run in designated regions; self-hosted deployments keep data wherever your policy requires — including air-gapped environments.',
  },
  {
    icon: ShieldCheck,
    title: 'Vulnerability disclosure',
    body: 'A public, coordinated disclosure program with a standard remediation window, safe-harbour language, and published advisories for fixed issues.',
  },
  {
    icon: Sparkles,
    title: 'Tenant isolation',
    body: 'Strong logical isolation per tenant with row- and connection-level enforcement. Cross-tenant access is impossible from application code.',
  },
  {
    icon: RotateCcw,
    title: 'Backups & disaster recovery',
    body: 'Continuous write-ahead-log archiving, verified snapshots, and periodic restore drills keep recovery objectives tight and tested.',
  },
];

const BADGES = [
  'DPDP Act 2023',
  'GDPR-ready',
  'FERPA-aligned',
  'ISO 27001',
  'SOC 2 (in progress)',
  'WCAG 2.1 AA',
];

/**
 * Security disclosures page.
 *
 * Baseline-controls grid, a responsible-disclosure callout, a compliance
 * badge strip linking to the compliance page, and a navy call-to-action.
 */
export default function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Trust & security"
        title="Security at the core"
        description="ProctiraERP handles some of the most sensitive data a society holds — student records. Every layer of the platform is engineered, reviewed, and audited with that responsibility in mind."
      />

      {/* Baseline controls */}
      <section className="container py-20" aria-labelledby="controls-heading">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Baseline controls
          </p>
          <h2
            id="controls-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            How we protect education data
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            These controls ship enabled by default on every deployment — cloud-managed
            or self-hosted.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {CONTROLS.map((control) => {
            const Icon = control.icon;
            return (
              <Card key={control.title}>
                <CardHeader>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <CardTitle className="mt-4">{control.title}</CardTitle>
                  <CardDescription>{control.body}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Responsible disclosure */}
      <section
        className="border-t border-border bg-secondary/30 py-16"
        aria-labelledby="disclosure-heading"
      >
        <div className="container">
          <div className="grid items-center gap-8 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-card p-8 md:grid-cols-[1fr_auto] md:p-10">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
                Responsible disclosure
              </p>
              <h2
                id="disclosure-heading"
                className="mt-3 text-2xl font-extrabold tracking-tight text-foreground"
              >
                Found something? Tell us first.
              </h2>
              <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">
                We appreciate good-faith security research. Email a report with
                reproduction steps and impact details to{' '}
                <a
                  className="font-medium text-primary hover:underline"
                  href="mailto:security@proctira.org"
                >
                  security@proctira.org
                </a>{' '}
                — we acknowledge within two business days, keep you informed
                through the fix, and credit researchers in our advisories.
              </p>
            </div>
            <Button asChild size="lg">
              <a href="mailto:security@proctira.org">
                <Mail aria-hidden="true" className="h-4 w-4" />
                Report a vulnerability
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Compliance badge strip */}
      <section className="container py-20" aria-labelledby="assurance-heading">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Assurance
          </p>
          <h2
            id="assurance-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            Compliance you can point to
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            See the dedicated{' '}
            <Link
              href="/compliance"
              className="font-medium text-primary hover:underline"
            >
              compliance page
            </Link>{' '}
            for plain-language detail on each framework.
          </p>
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {BADGES.map((badge) => (
            <span
              key={badge}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold text-muted-foreground shadow-sm"
            >
              <ShieldCheck
                aria-hidden="true"
                className="h-4 w-4 text-primary"
              />
              {badge}
            </span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="security-cta-heading"
      >
        <div className="container py-20 text-center">
          <h2
            id="security-cta-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Questions for our security team?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            Request our security overview, DPA template, and control narratives
            — or set up a call with the engineers who run the platform.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/contact">Request security evidence</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/compliance">Read the compliance page</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
