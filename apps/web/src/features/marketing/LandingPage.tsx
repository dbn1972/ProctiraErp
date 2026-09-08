'use client';

/**
 * LandingPage — public marketing landing page (Task 50.2).
 *
 * Anonymous-accessible. Registered via `featureRegistry.ts` as the index
 * of the `public` scope so the federated `RootRouter` can serve it at
 * `/`. The actual production route in Next.js is `app/(marketing)/page.tsx`
 * which re-exports this component, so the same source ships in both
 * routing surfaces.
 *
 * The full page chrome (header, footer, brand-aware document title) is
 * provided by `<MarketingLayout>` from Task 50.1. Copy is sourced through
 * `useLanguage().t()` with keys under `marketing.pages.landing.*`
 * (Requirement 31 AC 3, Property F-4) so every visible string is
 * translatable.
 */

import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  GraduationCap,
  Layers,
  Plug,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';

import { Badge, Button, Card, CardContent } from '@proctira/ui/components';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { useLanguage } from '@/providers/LanguageProvider';

const FEATURE_ICONS = [GraduationCap, BarChart3, Layers, ShieldCheck, WifiOff, Plug] as const;

export default function LandingPage() {
  const { t } = useLanguage();

  return (
    <MarketingLayout pageTitle={t('marketing.pages.landing.documentTitle')}>
      <main data-testid="marketing-landing-page" className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="border-b border-border bg-[hsl(var(--secondary))]">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-6 py-20 lg:px-8 lg:py-28">
            <Badge variant="secondary" className="bg-background text-foreground">
              {t('marketing.pages.landing.heroBadge')}
            </Badge>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              {t('marketing.pages.landing.heroHeading')}
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              {t('marketing.pages.landing.heroSubheading')}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button asChild size="lg" data-testid="landing-primary-cta">
                <Link href="/demo">
                  {t('marketing.pages.landing.primaryCta')}
                  <ArrowRight className="ms-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" data-testid="landing-secondary-cta">
                <Link href="/features">{t('marketing.pages.landing.secondaryCta')}</Link>
              </Button>
            </div>
            <p className="pt-6 text-sm text-muted-foreground">
              {t('marketing.pages.landing.trustBar')}
            </p>
          </div>
        </section>

        {/* Features grid */}
        <section className="border-b border-border bg-background">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:px-8 lg:py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {t('marketing.pages.landing.featuresHeading')}
              </h2>
              <p className="mt-4 text-base text-muted-foreground">
                {t('marketing.pages.landing.featuresSubheading')}
              </p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURE_ICONS.map((Icon, idx) => {
                const index = idx + 1;
                return (
                  <Card key={index} className="h-full">
                    <CardContent className="flex h-full flex-col gap-3 p-6">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(var(--secondary))] text-foreground">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {t(`marketing.pages.landing.feature${index}Title`)}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t(`marketing.pages.landing.feature${index}Body`)}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="bg-[hsl(var(--secondary))]">
          <div className="mx-auto flex w-full max-w-4xl flex-col items-start gap-4 px-6 py-16 lg:px-8 lg:py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t('marketing.pages.landing.ctaHeading')}
            </h2>
            <p className="max-w-2xl text-base text-muted-foreground">
              {t('marketing.pages.landing.ctaBody')}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button asChild size="lg">
                <Link href="/demo">{t('marketing.pages.landing.ctaPrimary')}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/contact">{t('marketing.pages.landing.ctaSecondary')}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
