import type { Metadata } from 'next';

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
  title: 'Compliance and trust',
  description:
    'Compliance posture for ProctiraERP: GDPR, FERPA, ISO 27001 alignment, accessibility, and our shared-responsibility model.',
  alternates: { canonical: '/compliance' },
  openGraph: {
    title: 'ProctiraERP Compliance',
    description: 'Compliance and trust posture for ProctiraERP.',
    url: '/compliance',
  },
};

const FRAMEWORKS = [
  {
    title: 'GDPR',
    status: 'Aligned',
    body: 'Data subject rights workflows, lawful basis tracking, processor agreements, and EU representative support are first-class capabilities.',
  },
  {
    title: 'FERPA',
    status: 'Aligned',
    body: 'Student record confidentiality, parent and eligible-student access, and directory information controls are built into the platform.',
  },
  {
    title: 'ISO 27001',
    status: 'Mapped',
    body: 'Annex A controls are mapped across the SDLC, infrastructure, and operational runbooks. Evidence is collected continuously.',
  },
  {
    title: 'SOC 2 Type II',
    status: 'On the roadmap',
    body: 'Cloud editions are pursuing SOC 2 Type II attestation. Self-host deployments inherit the underlying control design.',
  },
  {
    title: 'WCAG 2.1 AA',
    status: 'Met',
    body: 'All public properties and tenant-facing portals are designed and tested against WCAG 2.1 AA success criteria.',
  },
  {
    title: 'Local data residency',
    status: 'Configurable',
    body: 'Deploy in country or in any supported region. Data residency, processor selection, and key custody are tenant decisions.',
  },
];

/**
 * Compliance and trust disclosures page.
 *
 * Lists the frameworks ProctiraERP is aligned with, along with our position
 * on shared responsibility and tenant-controlled configuration.
 */
export default function CompliancePage() {
  return (
    <>
      <PageHero
        eyebrow="Trust"
        title="Compliance, posture, and shared responsibility"
        description="ProctiraERP is built to operate inside the privacy and accountability frameworks that govern education data around the world."
      />

      <section className="container py-16" aria-labelledby="frameworks-heading">
        <h2
          id="frameworks-heading"
          className="text-2xl font-bold tracking-tight text-foreground"
        >
          Frameworks and standards
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FRAMEWORKS.map((framework) => (
            <Card key={framework.title}>
              <CardHeader>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                  {framework.status}
                </p>
                <CardTitle className="mt-1">{framework.title}</CardTitle>
                <CardDescription>{framework.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section
        className="border-t border-border bg-secondary/30 py-16"
        aria-labelledby="responsibility-heading"
      >
        <div className="container">
          <h2
            id="responsibility-heading"
            className="text-2xl font-bold tracking-tight text-foreground"
          >
            Shared responsibility
          </h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>ProctiraERP provides</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Secure platform code, signed releases, and audit logs</li>
                  <li>Documented data flows, retention controls, and DPA templates</li>
                  <li>Identity, access, and break-glass control surfaces</li>
                  <li>Threat modelling and vulnerability remediation</li>
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Customers configure</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Lawful basis, retention, and consent policies</li>
                  <li>Data residency, processor selection, and SSO</li>
                  <li>Role assignments and approval chains</li>
                  <li>Incident communication and parent/student notice</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="container py-16" aria-labelledby="evidence-heading">
        <h2
          id="evidence-heading"
          className="text-2xl font-bold tracking-tight text-foreground"
        >
          Request evidence
        </h2>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Customers and prospects can request our trust pack — including
          security overview, DPIA template, and control narratives — from{' '}
          <a
            className="font-medium text-primary hover:underline"
            href="mailto:trust@proctira.org"
          >
            trust@proctira.org
          </a>
          .
        </p>
      </section>
    </>
  );
}
