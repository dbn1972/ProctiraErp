import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, Mail, MapPin, MessageSquare } from 'lucide-react';

import { ContactForm } from '@/components/contact-form';
import { PageHero } from '@/components/layout/page-hero';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Contact us',
  description:
    'Get in touch with the ProctiraERP team about deployments, partnerships, security, or general questions.',
  alternates: { canonical: '/contact' },
};

const CONTACT_CHANNELS = [
  {
    icon: Mail,
    title: 'Email',
    body: 'hello@proctira.org',
    href: 'mailto:hello@proctira.org',
  },
  {
    icon: MessageSquare,
    title: 'Security disclosures',
    body: 'security@proctira.org',
    href: 'mailto:security@proctira.org',
  },
  {
    icon: MapPin,
    title: 'Operating regions',
    body: 'Globally distributed team',
  },
];

/**
 * Contact page with a working contact form and direct channels.
 */
export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Talk to us"
        title="Let's plan your rollout"
        description="Whether you are deploying for a single school or a whole ministry, we would love to hear about your plans — pricing, pilots, training, and migration included."
      />

      <section className="container py-16">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="p-8">
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
              Send us a message
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Fill in the form and the right team will respond within two
              business days.
            </p>
            <div className="mt-6">
              <ContactForm />
            </div>
          </Card>

          <aside aria-label="Other ways to reach us" className="space-y-4">
            {CONTACT_CHANNELS.map((channel) => {
              const Icon = channel.icon;
              return (
                <div
                  key={channel.title}
                  className="flex items-start gap-4 rounded-lg border border-border bg-card p-5"
                >
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-foreground">
                      {channel.title}
                    </p>
                    {channel.href ? (
                      <a
                        href={channel.href}
                        className="mt-1 block text-sm text-primary hover:underline"
                      >
                        {channel.body}
                      </a>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {channel.body}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="flex items-start gap-4 rounded-lg border border-primary/20 bg-primary/5 p-5">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Clock aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <p className="text-base font-bold text-foreground">
                  Response times
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sales enquiries within two business days. Live-deployment
                  incidents are handled through the support helpline for your
                  edition.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* CTA */}
      <section
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="contact-cta-heading"
      >
        <div className="container py-20 text-center">
          <h2
            id="contact-cta-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Prefer to start hands-on?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            Self-host the open-source platform today — most teams have a working
            evaluation stack running in under an hour.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/installation">Read the installation guide</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/product">Take the product tour</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
