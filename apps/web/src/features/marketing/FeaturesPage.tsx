'use client';

/**
 * FeaturesPage — public Features overview (Task 50.2).
 *
 * Anonymous-accessible. Mounted at `/features` via `featureRegistry.ts`.
 * Wraps content in `<MarketingLayout>`. Copy comes through
 * `useLanguage().t()` under `marketing.pages.features.*` (Requirement 31
 * AC 3, Property F-4).
 */

import { Check } from 'lucide-react';

import { Card, CardContent } from '@proctira/ui/components';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { useLanguage } from '@/providers/LanguageProvider';

export default function FeaturesPage() {
  const { t } = useLanguage();

  return (
    <MarketingLayout pageTitle={t('marketing.pages.features.documentTitle')}>
      <main
        data-testid="marketing-features-page"
        className="flex flex-1 flex-col"
      >
        {/* Hero */}
        <section className="border-b border-border bg-[hsl(var(--secondary))]">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 lg:px-8 lg:py-24">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t('marketing.pages.features.eyebrow')}
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {t('marketing.pages.features.heading')}
            </h1>
            <p className="mt-4 max-w-3xl text-lg text-muted-foreground">
              {t('marketing.pages.features.lead')}
            </p>
          </div>
        </section>

        {/* Modules */}
        <section className="border-b border-border bg-background">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:px-8 lg:py-24">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('marketing.pages.features.categoriesHeading')}
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((index) => (
                <Card key={index} className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 p-6">
                    <h3 className="text-lg font-semibold text-foreground">
                      {t(`marketing.pages.features.category${index}Title`)}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {t(`marketing.pages.features.category${index}Body`)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Highlights */}
        <section className="bg-[hsl(var(--secondary))]">
          <div className="mx-auto w-full max-w-5xl px-6 py-16 lg:px-8 lg:py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t('marketing.pages.features.highlightsHeading')}
            </h2>
            <ul role="list" className="mt-8 grid gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4, 5, 6].map((index) => (
                <li key={index} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-foreground"
                  >
                    <Check className="h-4 w-4" />
                  </span>
                  <span className="text-base text-foreground">
                    {t(`marketing.pages.features.highlight${index}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
