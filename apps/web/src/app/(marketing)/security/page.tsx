import Link from 'next/link';

import { Button, Card, CardContent } from '@proctira/ui/components';
import {
  Lock,
  ScrollText,
  MapPin,
  Bug,
  Activity,
  DatabaseBackup,
} from 'lucide-react';

import {
  MarketingCtaBand,
  MarketingDocumentTitle,
  MarketingHero,
  MarketingSection,
  MarketingSectionHeading,
} from '@/features/marketing/sections/MarketingStaticChrome';

const CONTROLS = [
  {
    title: 'Encryption at rest & in transit',
    body: 'TLS 1.2+ everywhere and AES-256 at rest. Centralized secret management with automatic rotation and least-privilege access to keys.',
    Icon: Lock,
  },
  {
    title: 'RBAC & audit logs',
    body: 'Fine-grained, role-based permissions per module and field. Every sensitive read and every write is recorded in an immutable audit trail.',
    Icon: ScrollText,
  },
  {
    title: 'Data residency controls',
    body: 'Cloud tenants can pin storage to approved regions. Self-hosted deployments keep data wherever your policy requires — including air-gapped.',
    Icon: MapPin,
  },
  {
    title: 'Vulnerability disclosure',
    body: 'A coordinated disclosure program with a standard fix window, safe-harbour language, and published advisories for every fixed issue.',
    Icon: Bug,
  },
  {
    title: 'Assurance roadmap',
    body: 'SOC 2 Type II attestation is underway for the managed cloud, building on ISO 27001-aligned operations. Evidence packs available under NDA.',
    Icon: Activity,
  },
  {
    title: 'Backups & disaster recovery',
    body: 'Continuous WAL archiving, nightly verified snapshots, and quarterly restore drills on managed cloud.',
    Icon: DatabaseBackup,
  },
] as const;

const BADGES = [
  'DPDP Act 2023',
  'GDPR-ready',
  'FERPA-aligned',
  'ISO 27001',
  'SOC 2 (in progress)',
  'WCAG 2.2 AA',
] as const;

/**
 * Security overview — App Router page sourced from redesign/website/security.html.
 */
export default function SecurityPage() {
  return (
    <>
      <MarketingDocumentTitle pageTitle="Security" />
      <main
        data-testid="marketing-security-page"
        className="flex flex-1 flex-col"
      >
        <MarketingHero
          eyebrow="Trust & security"
          heading={
            <>
              Security at <span className="text-primary">the core</span>
            </>
          }
          lead="ProctiraERP handles some of the most sensitive data a society holds — student records. Every layer of the platform is engineered, reviewed, and audited with that responsibility in mind."
        />

        <MarketingSection>
          <MarketingSectionHeading
            kicker="Baseline controls"
            title="How we protect education data"
            subtitle="These controls ship enabled by default on every deployment — cloud-managed or self-hosted."
          />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CONTROLS.map(({ title, body, Icon }) => (
              <Card key={title} className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(var(--secondary))] text-foreground">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </MarketingSection>

        <MarketingSection alt>
          <div className="flex flex-col gap-6 rounded-lg border border-border bg-background p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="max-w-2xl space-y-2">
              <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Responsible disclosure
              </p>
              <h2 className="text-2xl font-semibold text-foreground">
                Found something? Tell us first.
              </h2>
              <p className="text-base text-muted-foreground">
                We appreciate good-faith security research. Email a report with
                reproduction steps and impact details to{' '}
                <a
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  href="mailto:security@proctira.org"
                >
                  security@proctira.org
                </a>{' '}
                — we acknowledge within two business days and credit researchers
                in our advisories.
              </p>
            </div>
            <Button asChild size="lg">
              <a href="mailto:security@proctira.org">Report a vulnerability</a>
            </Button>
          </div>
        </MarketingSection>

        <MarketingSection>
          <MarketingSectionHeading
            kicker="Assurance"
            title="Compliance you can point to"
            subtitle="See the dedicated compliance page for plain-language detail on each framework."
          />
          <div className="flex flex-wrap gap-3">
            {BADGES.map((badge) => (
              <span
                key={badge}
                className="inline-flex items-center rounded-md border border-border bg-[hsl(var(--secondary))] px-3 py-2 text-sm font-medium text-foreground"
              >
                {badge}
              </span>
            ))}
          </div>
          <div className="mt-8">
            <Button asChild variant="outline">
              <Link href="/security/compliance">Read the compliance page</Link>
            </Button>
          </div>
        </MarketingSection>

        <MarketingCtaBand
          heading="Questions for our security team?"
          body="Request our security overview, DPA template, and control narratives — or set up a call with the engineers who run the platform."
          primary={{ href: '/contact', label: 'Request security evidence' }}
          secondary={{
            href: '/security/compliance',
            label: 'Read the compliance page',
          }}
        />
      </main>
    </>
  );
}
