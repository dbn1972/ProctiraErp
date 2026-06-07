import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Accessibility,
  Github,
  Globe,
  Heart,
  Layers,
  ShieldCheck,
  Sparkles,
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
  title: 'About ProctiraERP',
  description:
    'Our mission, values, and approach to building open education management infrastructure.',
  alternates: { canonical: '/about' },
};

const VALUES = [
  {
    icon: Globe,
    title: 'Open by default',
    body: 'Public infrastructure deserves public code. We build in the open, document our decisions, and never gate safety or privacy features behind a paywall.',
  },
  {
    icon: Layers,
    title: 'Designed for scale',
    body: 'From a single classroom to a national ministry — the same platform, engineered to grow without rewriting, re-procuring, or re-training.',
  },
  {
    icon: ShieldCheck,
    title: 'Accountable with data',
    body: 'Student data is encrypted, audited, and governed by the institution — never sold, never mined, never used for anything but education.',
  },
  {
    icon: Accessibility,
    title: 'Locally adaptable',
    body: 'Different regions, different policies, different languages. Themes, plugins, and translations let each deployment feel like it was built at home.',
  },
  {
    icon: Sparkles,
    title: 'Built for real conditions',
    body: 'Shared devices, intermittent power, low-bandwidth networks. We test where our users teach — not just in the office on fibre.',
  },
  {
    icon: Heart,
    title: 'Educators first',
    body: 'Every feature is measured by one question: does this give a teacher more time with students? If not, it does not ship.',
  },
];

/**
 * About / Company page with mission, values, open-source, and careers anchor.
 */
export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="Our mission"
        title="Education infrastructure as a public good"
        description="We believe every learner is counted, every educator is supported, and every policymaker has the data they need — when the software that runs education is open, shared, and built to last."
      />

      {/* Story */}
      <section className="container py-20" aria-labelledby="story-heading">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Our story
          </p>
          <h2
            id="story-heading"
            className="mt-3 text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            Education software should be public infrastructure
          </h2>
          <div className="mt-6 space-y-5 text-lg leading-relaxed text-muted-foreground">
            <p>
              ProctiraERP began with a familiar problem: dedicated educators
              spending evenings re-typing the same attendance registers,
              scholarship lists, and exam results into a patchwork of
              disconnected spreadsheets and portals.
            </p>
            <p>
              Instead of building another proprietary portal, we made a
              different bet —{' '}
              <strong className="text-foreground">
                education management software should be public infrastructure
              </strong>
              : open source, self-hostable, and owned by the institutions that
              depend on it. No lock-in, no per-student licence fees, no black
              boxes around children&apos;s data.
            </p>
            <p>
              Every line of code remains Apache-2.0 licensed, and every
              improvement funded by one institution benefits all of them.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section
        className="border-t border-border bg-secondary/30 py-20"
        aria-labelledby="values-heading"
      >
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
              What we value
            </p>
            <h2
              id="values-heading"
              className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
            >
              Principles we build by
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {VALUES.map((value) => {
              const Icon = value.icon;
              return (
                <Card key={value.title}>
                  <CardHeader>
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <CardTitle className="mt-4">{value.title}</CardTitle>
                    <CardDescription>{value.body}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Open source */}
      <section
        id="opensource"
        className="container py-20"
        aria-labelledby="opensource-heading"
        style={{ scrollMarginTop: '5rem' }}
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Open source
          </p>
          <h2
            id="opensource-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            Built in the open, with a global community
          </h2>
        </div>
        <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-border bg-primary p-8 text-primary-foreground shadow-lg">
          <div className="flex flex-wrap items-center gap-3">
            <Github aria-hidden="true" className="h-6 w-6" />
            <span className="font-mono text-lg font-bold">
              proctira / proctira-erp
            </span>
            <span className="ml-auto rounded-full bg-primary-foreground/10 px-3 py-1 text-xs font-semibold">
              Apache-2.0
            </span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-primary-foreground/75">
            Open-source, multi-tenant education ERP for schools, districts, and
            ministries. PostgreSQL · Fastify · Next.js · Kubernetes-ready. Good
            first issues are labelled and mentored.
          </p>
        </div>
      </section>

      {/* Careers CTA */}
      <section
        id="careers"
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="careers-heading"
        style={{ scrollMarginTop: '5rem' }}
      >
        <div className="container py-20 text-center">
          <h2
            id="careers-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Build public infrastructure with us
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            We hire engineers, designers, educators, and operators who care
            about public-good infrastructure. Remote-friendly, mission-driven,
            and open by default.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <a href="mailto:careers@proctira.org">See open roles</a>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/contact">Partner with us</Link>
            </Button>
          </div>
          <p className="mt-6 text-sm text-primary-foreground/60">
            No role that fits? Send a note and a link to something you&apos;ve
            built — careers@proctira.org
          </p>
        </div>
      </section>
    </>
  );
}
