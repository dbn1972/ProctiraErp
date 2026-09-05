import type { Metadata } from 'next';
import Link from 'next/link';
import { Accessibility, Globe, GraduationCap, ShieldCheck } from 'lucide-react';

import { PageHero } from '@/components/layout/page-hero';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Compliance and trust',
  description:
    'Compliance posture for ProctiraERP: DPDP Act 2023, GDPR readiness, FERPA alignment, and WCAG 2.1 AA accessibility — explained in plain language.',
  alternates: { canonical: '/compliance' },
  openGraph: {
    title: 'ProctiraERP Compliance',
    description: 'Compliance and trust posture for ProctiraERP.',
    url: '/compliance',
  },
};

interface Framework {
  readonly icon: typeof ShieldCheck;
  readonly title: string;
  readonly status: string;
  readonly body: string;
  readonly meaning: string;
}

const FRAMEWORKS: ReadonlyArray<Framework> = [
  {
    icon: ShieldCheck,
    title: 'DPDP Act 2023',
    status: 'Aligned',
    body: "India's Digital Personal Data Protection Act sets the rules for processing personal data, with special safeguards for children. ProctiraERP implements consent capture, purpose limitation, breach-notification workflows, and Data Principal request handling.",
    meaning:
      'Parents and students can see, correct, and erase their data on request — and your institution can prove it acted lawfully, with consent records and audit trails ready for review.',
  },
  {
    icon: Globe,
    title: 'GDPR',
    status: 'Ready',
    body: "For deployments that touch EU residents, the platform supports GDPR's lawful-basis model: data minimisation, the full set of data-subject rights, processor agreements, and standard clauses for cross-border transfer.",
    meaning:
      'If your institution serves international students or partners with EU organisations, export, rectification, and erasure tooling is built in — no parallel privacy programme required.',
  },
  {
    icon: GraduationCap,
    title: 'FERPA-aligned',
    status: 'Aligned',
    body: 'The US Family Educational Rights and Privacy Act shapes global best practice for student records: records belong to students and parents, disclosure requires consent or a legitimate educational interest, and every access is logged.',
    meaning:
      'Teachers see only their classes. Clerks see only their modules. Guardians see only their children. Nobody browses student records without an audited reason.',
  },
  {
    icon: Accessibility,
    title: 'WCAG 2.1 AA',
    status: 'Tested',
    body: 'Public-facing and staff-facing screens are designed and tested against WCAG 2.1 Level AA: keyboard navigation, screen-reader semantics, 4.5:1 contrast, visible focus, and reduced-motion support.',
    meaning:
      'Staff and students with disabilities can use the platform independently — and government deployments meet accessibility obligations without retrofitting.',
  },
];

const RETENTION: ReadonlyArray<{
  category: string;
  detail: string;
  purpose: string;
  retention: string;
}> = [
  {
    category: 'Student identity & enrolment',
    detail: 'Name, date of birth, guardian details, admission records',
    purpose: 'Enrolment, academic administration, statutory reporting',
    retention: 'Duration of enrolment + statutory period',
  },
  {
    category: 'Attendance records',
    detail: 'Daily presence, late marks, leave records',
    purpose: 'Attendance monitoring, meal counts, scheme eligibility',
    retention: 'Academic year + configurable period',
  },
  {
    category: 'Assessment results',
    detail: 'Marks, grades, report cards',
    purpose: 'Academic progression, board submissions, transcripts',
    retention: 'Permanent (academic record)',
  },
  {
    category: 'Staff employment records',
    detail: 'Appointments, transfers, qualifications',
    purpose: 'HR administration and payroll integration',
    retention: 'Employment + configurable period',
  },
  {
    category: 'System & audit logs',
    detail: 'Access logs, change history, security events',
    purpose: 'Security monitoring, incident response, accountability',
    retention: 'Rolling, per operator policy',
  },
];

/**
 * Compliance and trust disclosures page.
 *
 * Framework cards with plain-language "what this means" callouts, a default
 * data-processing/retention summary, and a navy call-to-action.
 */
export default function CompliancePage() {
  return (
    <>
      <PageHero
        eyebrow="Trust & compliance"
        title="Compliance, in plain language"
        description="ProctiraERP is built to operate inside the privacy and accountability frameworks that govern education data around the world — and we explain what each one actually means for you."
      />

      {/* Frameworks */}
      <section className="container py-20" aria-labelledby="frameworks-heading">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Frameworks & standards
          </p>
          <h2
            id="frameworks-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            What we comply with — and why it matters
          </h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {FRAMEWORKS.map((framework) => {
            const Icon = framework.icon;
            return (
              <Card key={framework.title} className="flex flex-col p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <h3 className="text-lg font-bold tracking-tight text-foreground">
                    {framework.title}
                  </h3>
                  <span className="ml-auto rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
                    {framework.status}
                  </span>
                </div>
                <p className="mt-4 leading-relaxed text-muted-foreground">{framework.body}</p>
                <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">
                    What this means for you
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {framework.meaning}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Data processing table */}
      <section
        className="border-t border-border bg-secondary/30 py-20"
        aria-labelledby="processing-heading"
      >
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
              Transparency
            </p>
            <h2
              id="processing-heading"
              className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
            >
              What we process, and for how long
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              A summary of the default data-processing register. Self-hosted operators can adjust
              retention to local policy.
            </p>
          </div>
          <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-secondary/50">
                <tr>
                  <th className="px-5 py-3 font-semibold text-foreground">Data category</th>
                  <th className="px-5 py-3 font-semibold text-foreground">Purpose</th>
                  <th className="px-5 py-3 font-semibold text-foreground">Retention</th>
                </tr>
              </thead>
              <tbody>
                {RETENTION.map((row) => (
                  <tr key={row.category} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-4 align-top">
                      <span className="font-semibold text-foreground">{row.category}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{row.detail}</span>
                    </td>
                    <td className="px-5 py-4 align-top text-muted-foreground">{row.purpose}</td>
                    <td className="px-5 py-4 align-top text-muted-foreground">{row.retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="compliance-cta-heading"
      >
        <div className="container py-20 text-center">
          <h2
            id="compliance-cta-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Need evidence for a procurement review?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            Customers and prospects can request our trust pack — security overview, DPA template,
            control narratives, and accessibility conformance report.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/contact">Request the trust pack</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/security">Read the security page</Link>
            </Button>
          </div>
          <p className="mt-6 text-sm text-primary-foreground/60">
            Or email{' '}
            <a href="mailto:trust@proctira.org" className="underline-offset-4 hover:underline">
              trust@proctira.org
            </a>{' '}
            directly
          </p>
        </div>
      </section>
    </>
  );
}
