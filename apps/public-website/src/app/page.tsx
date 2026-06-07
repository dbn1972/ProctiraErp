import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  GraduationCap,
  Layers,
  Lock,
  Plug,
  ShieldCheck,
  Sparkles,
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
      'Admissions, enrollment, attendance, assessments, and graduation in one connected workflow.',
  },
  {
    icon: Users,
    title: 'Staff and HR',
    description:
      'Manage teachers, administrators, and support staff with role-based access and audit trails.',
  },
  {
    icon: BarChart3,
    title: 'Reporting and analytics',
    description:
      'Operational dashboards and exportable reports for schools, districts, and ministries.',
  },
  {
    icon: Layers,
    title: 'Multi-tenant by design',
    description:
      'One platform, many tenants. Strict data isolation with shared infrastructure economics.',
  },
  {
    icon: Plug,
    title: 'Plugins and themes',
    description:
      'Extend without forking. A signed plugin marketplace and theme system keep upgrades safe.',
  },
  {
    icon: ShieldCheck,
    title: 'Security and compliance',
    description:
      'Encryption in transit and at rest, immutable audit logs, and break-glass support controls.',
  },
];

const SOLUTIONS = [
  {
    id: 'solutions-schools',
    title: 'Schools',
    description:
      'Run day-to-day operations: timetables, attendance, grading, parent communication, and finance.',
  },
  {
    id: 'solutions-districts',
    title: 'Districts',
    description:
      'Aggregate school data, manage staffing, monitor outcomes, and run district-wide programs.',
  },
  {
    id: 'solutions-ministries',
    title: 'Ministries',
    description:
      'National EMIS reporting, policy rollouts, school census, and SDG-aligned indicators.',
  },
];

const TRUST_SIGNALS = [
  'GDPR-ready data protection workflows',
  'FERPA-aligned student data handling',
  'ISO 27001 security control mapping',
  'WCAG 2.1 AA accessibility',
];

/**
 * Public home page.
 *
 * Hero, key feature grid, solutions overview, trust signals, and a final
 * call-to-action. Renders fully static for fast TTFB and CDN cacheability.
 */
export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section
        className="relative overflow-hidden border-b border-border bg-gradient-to-b from-primary/5 via-background to-background"
        aria-labelledby="hero-heading"
      >
        <div className="container grid gap-10 py-20 md:grid-cols-2 md:items-center md:py-28">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              Education management, reimagined
            </p>
            <h1
              id="hero-heading"
              className="text-4xl font-bold tracking-tight text-foreground md:text-5xl lg:text-6xl"
            >
              The open platform for{' '}
              <span className="text-primary">modern education</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
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
                <Link href="/installation">View installation guide</Link>
              </Button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Free, open-source, and self-hostable. Cloud editions available.
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
                proctira.cloud / dashboard
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
      <section className="border-b border-border bg-secondary/30" aria-label="Trust signals">
        <div className="container flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-6 text-sm text-muted-foreground">
          <Lock aria-hidden="true" className="h-4 w-4" />
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
          <h2
            id="features-heading"
            className="text-3xl font-bold tracking-tight text-foreground md:text-4xl"
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
              <Card key={feature.title}>
                <CardHeader>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
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
            <h2
              id="solutions-heading"
              className="text-3xl font-bold tracking-tight text-foreground md:text-4xl"
            >
              Built for every level of education
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              From classroom rosters to national policy rollouts, ProctiraERP
              scales with the shape of your education system.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {SOLUTIONS.map((solution) => (
              <Card key={solution.id} id={solution.id}>
                <CardHeader>
                  <CardTitle>{solution.title}</CardTitle>
                  <CardDescription>{solution.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/product"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Learn more
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        id="pricing"
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="cta-heading"
      >
        <div className="container flex flex-col items-start justify-between gap-6 py-16 md:flex-row md:items-center">
          <div>
            <h2
              id="cta-heading"
              className="text-2xl font-bold tracking-tight md:text-3xl"
            >
              Ready to modernize your education system?
            </h2>
            <p className="mt-2 max-w-2xl text-primary-foreground/80">
              Open source forever. Cloud-managed editions available. Talk to
              our team about deployment, training, and support.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/contact">Contact sales</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
              <Link href="/installation">Self-host</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
