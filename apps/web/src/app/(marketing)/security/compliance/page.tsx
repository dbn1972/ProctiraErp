import { Card, CardContent } from '@proctira/ui/components';

import {
  MarketingCtaBand,
  MarketingDocumentTitle,
  MarketingHero,
  MarketingSection,
  MarketingSectionHeading,
} from '@/features/marketing/sections/MarketingStaticChrome';

const FRAMEWORKS = [
  {
    title: 'DPDP Act 2023',
    status: 'Aligned',
    body: "India's Digital Personal Data Protection Act sets the rules for collecting and processing personal data, with special safeguards for children. ProctiraERP implements verifiable consent capture, purpose limitation, breach notification workflows, and Data Principal request handling.",
    means:
      'Parents and students can see, correct, and erase their data on request — and your institution can prove it acted lawfully, with consent records and audit trails ready for review.',
  },
  {
    title: 'GDPR',
    status: 'Ready',
    body: "For deployments that touch EU residents, the platform supports GDPR's lawful-basis model: data minimisation, the full set of data-subject rights, processor agreements, and Standard Contractual Clauses for any cross-border transfer.",
    means:
      'If your institution serves international students or partners with EU organisations, you can deploy without building a parallel privacy programme — export, rectification, and erasure tooling is built in.',
  },
  {
    title: 'FERPA-aligned',
    status: 'Aligned',
    body: 'The US Family Educational Rights and Privacy Act shapes global best practice for student records. ProctiraERP mirrors its core ideas: education records belong to students and parents, disclosure requires consent or a legitimate educational interest, and every access is logged.',
    means:
      'Teachers see only their classes. Clerks see only their modules. Guardians see only their children. Nobody browses student records without an audited reason.',
  },
  {
    title: 'WCAG 2.2 AA',
    status: 'Tested',
    body: 'Public-facing and teacher-facing screens are designed and tested against WCAG 2.2 Level AA: keyboard navigation, screen-reader semantics, 4.5:1 contrast, visible focus, and reduced-motion support.',
    means:
      'Staff and students with disabilities can use the platform independently — government deployments meet accessibility obligations without retrofitting.',
  },
] as const;

const RETENTION = [
  [
    'Student identity & enrolment',
    'Enrolment, academic administration, statutory reporting',
    'Duration of enrolment + 7 years',
  ],
  [
    'Attendance records',
    'Attendance monitoring, scheme eligibility',
    'Academic year + 3 years',
  ],
  [
    'Assessment results',
    'Academic progression, board submissions, transcripts',
    'Permanent (academic record)',
  ],
  [
    'Scholarship & bank data',
    'Eligibility verification and disbursal',
    'Scheme closure + 5 years',
  ],
  [
    'Staff employment records',
    'HR administration',
    'Employment + 8 years',
  ],
  [
    'System & audit logs',
    'Security monitoring and accountability',
    '18 months (rolling)',
  ],
] as const;

/**
 * Compliance page — App Router page sourced from redesign/website/compliance.html.
 * Path matches marketing footer `Security → compliance` (`/security/compliance`).
 */
export default function CompliancePage() {
  return (
    <>
      <MarketingDocumentTitle pageTitle="Compliance" />
      <main
        data-testid="marketing-compliance-page"
        className="flex flex-1 flex-col"
      >
        <MarketingHero
          eyebrow="Trust & compliance"
          heading={
            <>
              Compliance, in <span className="text-primary">plain language</span>
            </>
          }
          lead="ProctiraERP is built to operate inside the privacy and accountability frameworks that govern education data — and we explain what each one actually means for you."
        />

        <MarketingSection>
          <MarketingSectionHeading
            kicker="Frameworks & standards"
            title="What we comply with — and why it matters"
          />
          <div className="grid gap-6 md:grid-cols-2">
            {FRAMEWORKS.map((item) => (
              <Card key={item.title} className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-semibold text-foreground">
                      {item.title}
                    </h3>
                    <span className="rounded-md bg-[hsl(var(--secondary))] px-2 py-1 text-xs font-medium text-muted-foreground">
                      {item.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                  <p className="mt-auto border-t border-border pt-3 text-sm text-foreground">
                    <span className="font-semibold">What this means for you. </span>
                    {item.means}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </MarketingSection>

        <MarketingSection alt>
          <MarketingSectionHeading
            kicker="Transparency"
            title="What we process, and for how long"
            subtitle="A summary of the default data-processing register. Self-hosted operators can adjust retention to local policy."
          />
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-[hsl(var(--secondary))] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Data category</th>
                  <th className="px-4 py-3 font-medium">Purpose</th>
                  <th className="px-4 py-3 font-medium">Retention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {RETENTION.map(([category, purpose, retention]) => (
                  <tr key={category}>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {category}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{purpose}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {retention}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MarketingSection>

        <MarketingCtaBand
          heading="Need evidence for a procurement review?"
          body="Customers and prospects can request our trust pack — security overview, DPA template, control narratives, and accessibility conformance report."
          primary={{ href: '/contact', label: 'Request the trust pack' }}
          secondary={{ href: '/security', label: 'Read the security page' }}
        />
      </main>
    </>
  );
}
