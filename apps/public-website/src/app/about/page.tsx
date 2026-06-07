import type { Metadata } from 'next';

import { PageHero } from '@/components/layout/page-hero';
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
    title: 'Open by default',
    body: 'Education infrastructure is public infrastructure. We build it in the open and give it to those who need it.',
  },
  {
    title: 'Designed for scale',
    body: 'From a single classroom to a national ministry, ProctiraERP is engineered to grow without rewriting.',
  },
  {
    title: 'Accountable',
    body: 'We treat student data with the seriousness it deserves: encrypted, audited, and governed.',
  },
  {
    title: 'Locally adaptable',
    body: 'Different countries, different policies, different languages. The platform bends to context.',
  },
];

/**
 * About / Company page with mission, values, and careers anchor.
 */
export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="Company"
        title="Education infrastructure that everyone can build on"
        description="ProctiraERP exists to give every education system — public or private, large or small — a modern, secure, and open platform."
      />

      <section className="container py-16" aria-labelledby="mission-heading">
        <div className="mx-auto max-w-3xl">
          <h2
            id="mission-heading"
            className="text-2xl font-bold tracking-tight text-foreground"
          >
            Our mission
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            We believe in a world where every learner is counted, every
            educator is supported, and every policymaker has the data they
            need. Building that world starts with shared, open
            infrastructure that respects privacy, scales globally, and
            adapts to local context.
          </p>
        </div>
      </section>

      <section
        className="border-t border-border bg-secondary/30 py-16"
        aria-labelledby="values-heading"
      >
        <div className="container">
          <h2
            id="values-heading"
            className="text-2xl font-bold tracking-tight text-foreground"
          >
            What we value
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {VALUES.map((value) => (
              <Card key={value.title}>
                <CardHeader>
                  <CardTitle>{value.title}</CardTitle>
                  <CardDescription>{value.body}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section
        id="careers"
        className="container py-16"
        aria-labelledby="careers-heading"
      >
        <h2
          id="careers-heading"
          className="text-2xl font-bold tracking-tight text-foreground"
        >
          Careers
        </h2>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          We hire engineers, designers, educators, and operators who care
          about public-good infrastructure. Send a note and a short bio to{' '}
          <a
            className="font-medium text-primary hover:underline"
            href="mailto:careers@proctira.org"
          >
            careers@proctira.org
          </a>{' '}
          — we read every email.
        </p>
      </section>
    </>
  );
}
