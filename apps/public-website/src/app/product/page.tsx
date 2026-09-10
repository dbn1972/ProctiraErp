import type { Metadata } from 'next';
import Link from 'next/link';
import { Award, BarChart3, CalendarCheck, ClipboardList, GraduationCap } from 'lucide-react';

import { PageHero } from '@/components/layout/page-hero';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Product overview',
  description:
    'Explore the ProctiraERP modules: students, attendance, assessments, scholarships, analytics, and integrations across schools, districts, and ministries.',
  alternates: { canonical: '/product' },
  openGraph: {
    title: 'ProctiraERP Product Overview',
    description: 'Modules and capabilities of the ProctiraERP platform.',
    url: '/product',
  },
};

interface FeatureRow {
  readonly id: string;
  readonly icon: typeof GraduationCap;
  readonly kicker: string;
  readonly title: string;
  readonly description: string;
  readonly points: ReadonlyArray<string>;
}

const FEATURE_ROWS: ReadonlyArray<FeatureRow> = [
  {
    id: 'students',
    icon: GraduationCap,
    kicker: 'Student lifecycle',
    title: 'Every student record, complete and current',
    description:
      'Admissions, enrolment, section allocation, transfers, and graduation live in one timeline per student. Identity, guardian details, and a document vault are included.',
    points: [
      'Online admissions with merit lists and seat matrices',
      'Bulk promotion and inter-school transfer certificates',
      'Special education and inclusion program tagging',
    ],
  },
  {
    id: 'attendance',
    icon: CalendarCheck,
    kicker: 'Attendance',
    title: 'Attendance that works offline-first',
    description:
      'Teachers mark a full class in under a minute — on shared tablets, low-end phones, or paper-sync mode for no-network days. Data reconciles automatically when connectivity returns.',
    points: [
      'One-tap class marking with biometric and RFID options',
      'SMS alerts to guardians for unexplained absences',
      'Mid-day meal counts generated from the same register',
    ],
  },
  {
    id: 'assessments',
    icon: ClipboardList,
    kicker: 'Assessments',
    title: 'From question paper to report card',
    description:
      'Plan exams across boards and terms, capture marks in bulk, moderate grades with full audit history, and publish report cards parents can actually read.',
    points: [
      'CBSE, ICSE, and state-board grading schemes built in',
      'Continuous assessment (FA/SA) with weighted aggregation',
      'Result analytics by subject, section, and teacher',
    ],
  },
  {
    id: 'scholarships',
    icon: Award,
    kicker: 'Scholarships & DBT',
    title: 'Scholarships that reach the right students',
    description:
      'Eligibility engines match students to central and state schemes. Applications, verification, sanction, and disbursal are tracked end to end — with duplicate-payout safeguards.',
    points: [
      'Pre-Matric, Post-Matric, and state schemes pre-configured',
      'eKYC and bank-seeding validation before sanction',
      'Disbursal files and reconciliation reports',
    ],
  },
  {
    id: 'analytics',
    icon: BarChart3,
    kicker: 'Analytics',
    title: 'Decisions backed by live data',
    description:
      'Pre-built dashboards roll attendance, results, and finance up from classroom to ministry. Slice by district, block, gender, or scheme — and export to standard formats.',
    points: [
      'Drop-out risk signals from attendance and result trends',
      'District league boards with drill-down to each school',
      'Scheduled email and PDF reports for review meetings',
    ],
  },
];

const INTEGRATIONS: ReadonlyArray<{ label: string; color: string }> = [
  { label: 'UDISE+', color: 'bg-primary' },
  { label: 'DigiLocker', color: 'bg-accent' },
  { label: 'Aadhaar eKYC', color: 'bg-yellow-500' },
  { label: 'SMS gateways', color: 'bg-sky-500' },
  { label: 'PFMS / DBT', color: 'bg-violet-500' },
  { label: 'DIKSHA content', color: 'bg-emerald-500' },
];

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-base text-muted-foreground">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3"
        >
          <path d="m5 13 4 4L19 7" />
        </svg>
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Product tour page.
 *
 * A bold hero followed by alternating feature rows (one per module), an
 * integrations strip, and a navy call-to-action band.
 */
export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product tour"
        title="One platform, every education workflow"
        description="ProctiraERP combines proven modules for students, staff, institutions, finance, and reporting — with the integrations and governance you need to run education at scale."
      />

      <section className="border-b border-border bg-background">
        <div className="container flex flex-wrap gap-3 py-5">
          <Button asChild size="lg">
            <Link href="/contact">Request a demo</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/installation">Self-host it instead</Link>
          </Button>
        </div>
      </section>

      <section className="container" aria-label="Modules">
        {FEATURE_ROWS.map((row, index) => {
          const Icon = row.icon;
          const flipped = index % 2 === 1;
          return (
            <div
              key={row.id}
              id={row.id}
              className="grid items-center gap-10 border-b border-border py-14 md:grid-cols-2 md:gap-16 lg:py-16"
              style={{ scrollMarginTop: '5rem' }}
            >
              <div className={flipped ? 'md:order-2' : undefined}>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
                  {row.kicker}
                </p>
                <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">
                  {row.title}
                </h2>
                <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                  {row.description}
                </p>
                <ul className="mt-6 space-y-3">
                  {row.points.map((point) => (
                    <CheckItem key={point}>{point}</CheckItem>
                  ))}
                </ul>
              </div>

              <div
                aria-hidden="true"
                className={
                  (flipped ? 'md:order-1 ' : '') +
                  'flex h-64 items-center justify-center rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-secondary/40 shadow-sm'
                }
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                  <Icon className="h-8 w-8" />
                </span>
              </div>
            </div>
          );
        })}
      </section>

      {/* Integrations */}
      <section
        id="integrations"
        className="border-t border-border bg-secondary/30 py-20"
        aria-labelledby="integrations-heading"
        style={{ scrollMarginTop: '5rem' }}
      >
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
              Integrations
            </p>
            <h2
              id="integrations-heading"
              className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
            >
              Plays well with public digital infrastructure
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              First-class connectors keep ProctiraERP in sync with the systems your government
              already runs.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {INTEGRATIONS.map((integration) => (
              <span
                key={integration.label}
                className="inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-5 py-2.5 text-base font-semibold text-muted-foreground shadow-sm"
              >
                <span
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 rounded-sm ${integration.color}`}
                />
                {integration.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="product-cta-heading"
      >
        <div className="container py-20 text-center">
          <h2
            id="product-cta-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            See the full platform in action
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            Get a guided walkthrough tailored to your schools, district, or ministry — or spin up
            your own instance from the installation guide.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/contact">Request a demo</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/installation">Read the installation guide</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
