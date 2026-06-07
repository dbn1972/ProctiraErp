'use client';

/**
 * DemoPage — public demo request page (Task 50.2).
 *
 * Anonymous-accessible. Mounted at `/demo` via `featureRegistry.ts`.
 * Wraps content in `<MarketingLayout>`. Copy comes through
 * `useLanguage().t()` under `marketing.pages.demo.*` (Requirement 31
 * AC 3, Property F-4).
 *
 * The page collects intent (an email link rather than a form) so the
 * marketing site stays anonymous-only. A future task can add a hosted
 * scheduling form once the lead-routing service ships.
 */

import { Check, Mail } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { useLanguage } from '@/providers/LanguageProvider';

const DEMO_EMAIL = 'demo@proctira.org';

export default function DemoPage() {
  const { t } = useLanguage();

  return (
    <MarketingLayout pageTitle={t('marketing.pages.demo.documentTitle')}>
      <main data-testid="marketing-demo-page" className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="border-b border-border bg-[hsl(var(--secondary))]">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 lg:px-8 lg:py-24">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t('marketing.pages.demo.eyebrow')}
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {t('marketing.pages.demo.heading')}
            </h1>
            <p className="mt-4 max-w-3xl text-lg text-muted-foreground">
              {t('marketing.pages.demo.lead')}
            </p>
          </div>
        </section>

        {/* Agenda */}
        <section className="border-b border-border bg-background">
          <div className="mx-auto w-full max-w-5xl px-6 py-16 lg:px-8 lg:py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t('marketing.pages.demo.agendaHeading')}
            </h2>
            <ul role="list" className="mt-8 space-y-4">
              {[1, 2, 3, 4, 5].map((index) => (
                <li key={index} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--secondary))] text-foreground"
                  >
                    <Check className="h-4 w-4" />
                  </span>
                  <span className="text-base text-foreground">
                    {t(`marketing.pages.demo.agendaItem${index}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Audience + Preparation */}
        <section className="border-b border-border bg-[hsl(var(--secondary))]">
          <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-16 md:grid-cols-2 lg:px-8 lg:py-20">
            <Card className="h-full">
              <CardContent className="flex h-full flex-col gap-3 p-6">
                <h2 className="text-xl font-semibold text-foreground">
                  {t('marketing.pages.demo.audienceHeading')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('marketing.pages.demo.audienceBody')}
                </p>
              </CardContent>
            </Card>
            <Card className="h-full">
              <CardContent className="flex h-full flex-col gap-3 p-6">
                <h2 className="text-xl font-semibold text-foreground">
                  {t('marketing.pages.demo.preparationHeading')}
                </h2>
                <ul role="list" className="space-y-2">
                  {[1, 2, 3].map((index) => (
                    <li key={index} className="text-sm text-muted-foreground">
                      • {t(`marketing.pages.demo.preparationItem${index}`)}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-background">
          <div className="mx-auto flex w-full max-w-4xl flex-col items-start gap-4 px-6 py-16 lg:px-8 lg:py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t('marketing.pages.demo.ctaHeading')}
            </h2>
            <p className="max-w-2xl text-base text-muted-foreground">
              {t('marketing.pages.demo.ctaBody')}
            </p>
            <Button asChild size="lg" className="mt-2" data-testid="demo-cta">
              <a href={`mailto:${DEMO_EMAIL}`}>
                <Mail className="me-2 h-4 w-4" aria-hidden="true" />
                {t('marketing.pages.demo.ctaButton')}
              </a>
            </Button>
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
