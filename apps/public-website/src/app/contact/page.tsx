import type { Metadata } from 'next';
import { Mail, MapPin, MessageSquare } from 'lucide-react';

import { ContactForm } from '@/components/contact-form';
import { PageHero } from '@/components/layout/page-hero';

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
 * Contact page with a stubbed contact form and direct channels.
 */
export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Talk to us"
        title="Contact ProctiraERP"
        description="Whether you are deploying for a single school or a whole ministry, we would love to hear about your plans."
      />
      <section className="container py-16">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Send us a message
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Fill in the form and we will respond within two business days.
            </p>
            <div className="mt-6">
              <ContactForm />
            </div>
          </div>
          <aside aria-label="Other ways to reach us">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Other ways to reach us
            </h2>
            <ul className="mt-6 space-y-4">
              {CONTACT_CHANNELS.map((channel) => {
                const Icon = channel.icon;
                return (
                  <li
                    key={channel.title}
                    className="flex items-start gap-4 rounded-lg border border-border bg-card p-4"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {channel.title}
                      </p>
                      {channel.href ? (
                        <a
                          href={channel.href}
                          className="text-sm text-primary hover:underline"
                        >
                          {channel.body}
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {channel.body}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      </section>
    </>
  );
}
