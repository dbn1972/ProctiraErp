import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  GraduationCap,
  Landmark,
  LayoutGrid,
  Lock,
  Package,
  School,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'ProctiraERP — Open Education Management Platform',
  description:
    'ProctiraERP is the open, multi-tenant education management platform for schools, districts, and ministries. Secure, accessible, and built for global deployment.',
  alternates: { canonical: '/' },
};

const FEATURES = [
  {
    icon: GraduationCap,
    title: 'Student lifecycle',
    description:
      'Admissions, enrolment, attendance, assessments, and graduation in one connected workflow — from first application to transfer certificate.',
  },
  {
    icon: Users,
    title: 'Staff & HR',
    description:
      'Manage teachers, administrators, and support staff with role-based access, transfers, payroll integration, and complete audit trails.',
  },
  {
    icon: BarChart3,
    title: 'Reporting & analytics',
    description:
      'Operational dashboards and exportable reports for schools, districts, and ministries — UDISE+ ready, refreshed in near real time.',
  },
  {
    icon: Boxes,
    title: 'Multi-tenant by design',
    description:
      'One deployment, thousands of institutions. Strict data isolation per tenant with shared infrastructure economics and central policy control.',
  },
  {
    icon: Package,
    title: 'Plugins & themes',
    description:
      'Extend without forking. A signed plugin marketplace and theme system keep upgrades safe while you adapt the platform to local needs.',
  },
  {
    icon: ShieldCheck,
    title: 'Security & compliance',
    description:
      'Encryption in transit and at rest, role-based access control, immutable audit logs, and break-glass support controls — compliant by default.',
  },
];

interface Solution {
  readonly id: string;
  readonly icon: typeof School;
  readonly title: string;
  readonly description: string;
  readonly points: ReadonlyArray<string>;
  readonly cta: { readonly href: string; readonly label: string };
}

const SOLUTIONS: ReadonlyArray<Solution> = [
  {
    id: 'solutions-schools',
    icon: School,
    title: 'Schools',
    description: 'Run the day-to-day with less paperwork and more teaching time.',
    points: [
      'Daily timetables, attendance, and receipts',
      'Parent communication over SMS and messaging channels',
      'Exam scheduling, grading, and report cards',
      'Works on shared devices and low bandwidth',
    ],
    cta: { href: '/product', label: 'Explore for schools' },
  },
  {
    id: 'solutions-districts',
    icon: LayoutGrid,
    title: 'Districts',
    description:
      'Aggregate school data, manage staffing, and monitor outcomes across every block.',
    points: [
      'Cross-school dashboards and league reports',
      'Teacher deployment and transfer workflows',
      'Scholarship and DBT disbursal tracking',
      'Block- and cluster-level role hierarchies',
    ],
    cta: { href: '/product', label: 'Explore for districts' },
  },
  {
    id: 'solutions-ministries',
    icon: Landmark,
    title: 'Ministries',
    description:
      'National EMIS reporting, policy rollouts, and sovereign data control at scale.',
    points: [
      'State-wide multi-tenant deployment',
      'UDISE+ and census-grade data exports',
      'Data residency on your own cloud',
      'Central policy rollout and audit',
    ],
    cta: { href: '/contact', label: 'Talk to our public-sector team' },
  },
];

const TRUST_SIGNALS = [
  'GDPR-ready data protection',
  'FERPA-aligned handling',
  'ISO 27001 control mapping',
  'WCAG 2.1 AA accessibility',
];

/**
 * Public home page.
 *
 * Bold hero with a decorative dashboard preview, trust strip, feature grid,
 * solutions overview, a navy stat band, and a strong final call-to-action.
 * Renders fully static for fast TTFB and CDN cacheability.
 */
export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section
        className="relative overflow-hidden border-b border-border bg-gradient-to-b from-primary/5 via-background to-background"
        aria-labelledby="hero-heading"
      >
        <div className="container grid gap-12 py-20 md:grid-cols-2 md:items-center md:py-28">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1.5 text-xs font-bold tracking-wide text-accent">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-accent ring-4 ring-accent/20"
              />
              Open source · Education infrastructure
            </p>
            <h1
              id="hero-heading"
              className="text-4xl font-extrabold tracking-tight text-foreground md:text-5xl lg:text-6xl"
            >
              The open platform for{' '}
              <span className="text-primary">modern education</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              ProctiraERP unifies students, staff, finance, and analytics across
              schools, districts, and ministries — with the security, scale,
              and flexibility every education system needs.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/contact">
                  Talk to sales
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/installation">
                  View installation guide
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Free, open source, and self-hostable. Cloud editions available for
              districts and states.
            </p>
          </div>

          <div
            aria-hidden="true"
            className="relative hidden h-80 rounded-2xl border border-border bg-card p-6 shadow-xl md:block"
          >
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <span className="h-3 w-3 rounded-full bg-destructive/60" />
              <span className="h-3 w-3 rounded-full bg-yellow-400/70" />
              <span className="h-3 w-3 rounded-full bg-accent/70" />
              <span className="ml-2 text-xs text-muted-foreground">
                app.proctira.org / dashboard
              </span>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { label: 'Students', value: '24,812' },
                { label: 'Schools', value: '142' },
                { label: 'Attendance', value: '96.4%' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-border bg-secondary/50 p-3"
                >
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-6 space-y-2">
              <div className="h-2.5 w-full rounded-full bg-secondary" />
              <div className="h-2.5 w-4/5 rounded-full bg-primary/70" />
              <div className="h-2.5 w-3/5 rounded-full bg-accent/70" />
              <div className="h-2.5 w-2/5 rounded-full bg-secondary" />
            </div>
          </div>
        </div>
      </section>

      {/* Trust signals */}
      <section
        className="border-b border-border bg-secondary/30"
        aria-label="Trust signals"
      >
        <div className="container flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-6 text-sm text-muted-foreground">
          <Lock aria-hidden="true" className="h-4 w-4 text-primary" />
          {TRUST_SIGNALS.map((signal) => (
            <span key={signal} className="font-medium">
              {signal}
            </span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="container py-20" aria-labelledby="features-heading">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
            The platform
          </p>
          <h2
            id="features-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            Everything an education system needs
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            A complete platform with the modules, integrations, and governance
            controls to run a school, a district, or an entire ministry.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card
                key={feature.title}
                className="transition-shadow hover:shadow-md"
              >
                <CardHeader>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <CardTitle className="mt-4">{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Solutions */}
      <section
        id="solutions"
        className="border-t border-border bg-secondary/30 py-20"
        aria-labelledby="solutions-heading"
      >
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
              Solutions
            </p>
            <h2
              id="solutions-heading"
              className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
            >
              Built for every level of education
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              From classroom rosters to national policy rollouts, ProctiraERP
              scales with the shape of your education system.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {SOLUTIONS.map((solution) => {
              const Icon = solution.icon;
              return (
                <Card
                  key={solution.id}
                  id={solution.id}
                  className="flex flex-col"
                >
                  <CardHeader>
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <CardTitle className="mt-4">{solution.title}</CardTitle>
                    <CardDescription>{solution.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col">
                    <ul className="space-y-2.5 text-sm text-muted-foreground">
                      {solution.points.map((point) => (
                        <li key={point} className="flex items-start gap-2">
                          <span
                            aria-hidden="true"
                            className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-2.5 w-2.5"
                            >
                              <path d="m5 13 4 4L19 7" />
                            </svg>
                          </span>
                          {point}
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={solution.cta.href}
                      className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                    >
                      {solution.cta.label}
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section
        className="border-t border-border bg-primary text-primary-foreground"
        aria-label="Platform at a glance"
      >
        <div className="container py-16">
          <div className="grid gap-10 text-center md:grid-cols-3">
            {[
              { value: '24,812', label: 'students managed every day' },
              { value: '142', label: 'schools live in the pilot deployment' },
              {
                value: '96.4%',
                label: 'average attendance captured digitally',
              },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-4xl font-extrabold tracking-tight md:text-5xl">
                  {stat.value}
                </p>
                <p className="mt-2 text-sm text-primary-foreground/70">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-9 text-center text-sm text-primary-foreground/60">
            Illustrative figures from a pilot deployment preview.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section
        id="pricing"
        className="border-t border-primary-foreground/10 bg-primary text-primary-foreground"
        aria-labelledby="cta-heading"
      >
        <div className="container py-20 text-center">
          <h2
            id="cta-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Ready to modernize your education system?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            Talk to our team about deployment, training, and support — or
            self-host the open-source platform today and see it running in under
            an hour.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/contact">Contact sales</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/installation">Self-host ProctiraERP</Link>
            </Button>
          </div>
          <p className="mt-6 text-sm text-primary-foreground/60">
            Apache-2.0 licensed · No per-student fees on self-hosted deployments
          </p>
        </div>
      </section>
    </>
  );
}
