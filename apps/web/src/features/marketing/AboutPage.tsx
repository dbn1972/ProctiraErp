'use client';

/**
 * AboutPage — public About page (Task 50.2).
 *
 * Anonymous-accessible. Mounted at `/about` via `featureRegistry.ts`.
 * Wraps content in `<MarketingLayout>` so the shared header, footer, and
 * brand-aware document title are consistent across the marketing surface.
 *
 * Copy is sourced through `useLanguage().t()` with keys under
 * `marketing.pages.about.*` (Requirement 31 AC 3, Property F-4).
 */

import { Globe, Heart, Layers, WifiOff } from 'lucide-react';

import { Card, CardContent } from '@proctira/ui/components';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { useLanguage } from '@/providers/LanguageProvider';

const PRINCIPLE_ICONS = [Heart, Layers, Globe, WifiOff] as const;

export default function AboutPage() {
  const { t } = useLanguage();

  return (
    <MarketingLayout pageTitle={t('marketing.pages.about.documentTitle')}>
      <main data-testid="marketing-about-page" className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="border-b border-border bg-[hsl(var(--secondary))]">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 lg:px-8 lg:py-24">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t('marketing.pages.about.eyebrow')}
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {t('marketing.pages.about.heading')}
            </h1>
            <p className="mt-4 max-w-3xl text-lg text-muted-foreground">
              {t('marketing.pages.about.lead')}
            </p>
          </div>
        </section>

        {/* Mission & Vision */}
        <section className="border-b border-border bg-background">
          <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-16 md:grid-cols-2 lg:px-8 lg:py-20">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">
                {t('marketing.pages.about.missionTitle')}
              </h2>
              <p className="mt-3 text-base text-muted-foreground">
                {t('marketing.pages.about.missionBody')}
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-foreground">
                {t('marketing.pages.about.visionTitle')}
              </h2>
              <p className="mt-3 text-base text-muted-foreground">
                {t('marketing.pages.about.visionBody')}
              </p>
            </div>
          </div>
        </section>

        {/* Principles */}
        <section className="border-b border-border bg-[hsl(var(--secondary))]">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:px-8 lg:py-24">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('marketing.pages.about.principlesHeading')}
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {PRINCIPLE_ICONS.map((Icon, idx) => {
                const index = idx + 1;
                return (
                  <Card key={index} className="h-full">
                    <CardContent className="flex h-full flex-col gap-3 p-6">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-background text-foreground">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {t(`marketing.pages.about.principle${index}Title`)}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t(`marketing.pages.about.principle${index}Body`)}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="bg-background">
          <div className="mx-auto w-full max-w-5xl px-6 py-16 lg:px-8 lg:py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t('marketing.pages.about.statsHeading')}
            </h2>
            <dl className="mt-10 grid gap-8 sm:grid-cols-3">
              {[1, 2, 3].map((index) => (
                <div key={index} className="border-l-2 border-border ps-6">
                  <dt className="text-4xl font-semibold tracking-tight text-foreground">
                    {t(`marketing.pages.about.stat${index}Value`)}
                  </dt>
                  <dd className="mt-2 text-sm text-muted-foreground">
                    {t(`marketing.pages.about.stat${index}Label`)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
