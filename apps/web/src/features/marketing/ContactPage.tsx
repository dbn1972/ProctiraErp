'use client';

/**
 * ContactPage — public contact entry point (Task 50.2).
 *
 * Anonymous-accessible. Mounted at `/contact` via `featureRegistry.ts`.
 * Wraps content in `<MarketingLayout>`. Copy comes through
 * `useLanguage().t()` under `marketing.pages.contact.*` (Requirement 31
 * AC 3, Property F-4).
 */

import Link from 'next/link';
import { LifeBuoy, Mail, Users } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { useLanguage } from '@/providers/LanguageProvider';

interface ContactChannel {
  /** Translation-key prefix under `marketing.pages.contact`. */
  key: 'sales' | 'support' | 'community';
}

const CHANNELS: readonly ContactChannel[] = [
  { key: 'sales' },
  { key: 'support' },
  { key: 'community' },
] as const;

const CHANNEL_ICONS: Record<ContactChannel['key'], typeof Mail> = {
  sales: Mail,
  support: LifeBuoy,
  community: Users,
};

export default function ContactPage() {
  const { t } = useLanguage();

  return (
    <MarketingLayout pageTitle={t('marketing.pages.contact.documentTitle')}>
      <main data-testid="marketing-contact-page" className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="border-b border-border bg-[hsl(var(--secondary))]">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 lg:px-8 lg:py-24">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t('marketing.pages.contact.eyebrow')}
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {t('marketing.pages.contact.heading')}
            </h1>
            <p className="mt-4 max-w-3xl text-lg text-muted-foreground">
              {t('marketing.pages.contact.lead')}
            </p>
          </div>
        </section>

        {/* Channels */}
        <section className="border-b border-border bg-background">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:px-8 lg:py-24">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {CHANNELS.map(({ key }) => {
                const Icon = CHANNEL_ICONS[key];
                const email = t(`marketing.pages.contact.${key}Email`);
                return (
                  <Card key={key} data-testid={`contact-channel-${key}`} className="h-full">
                    <CardContent className="flex h-full flex-col gap-3 p-6">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(var(--secondary))] text-foreground">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <h2 className="text-lg font-semibold text-foreground">
                        {t(`marketing.pages.contact.${key}Title`)}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {t(`marketing.pages.contact.${key}Body`)}
                      </p>
                      <a
                        href={`mailto:${email}`}
                        className="mt-auto break-all text-sm font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {email}
                      </a>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Offices + CTA */}
        <section className="bg-[hsl(var(--secondary))]">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 md:grid-cols-2 lg:px-8 lg:py-20">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">
                {t('marketing.pages.contact.officesHeading')}
              </h2>
              <p className="mt-3 text-base text-muted-foreground">
                {t('marketing.pages.contact.officesBody')}
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-foreground">
                {t('marketing.pages.contact.ctaHeading')}
              </h2>
              <p className="mt-3 text-base text-muted-foreground">
                {t('marketing.pages.contact.ctaBody')}
              </p>
              <Button asChild size="lg" className="mt-6">
                <Link href="/demo">{t('marketing.pages.contact.ctaButton')}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
