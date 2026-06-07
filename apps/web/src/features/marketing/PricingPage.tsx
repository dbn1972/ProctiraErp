'use client';

/**
 * PricingPage — public pricing tiers (Task 50.2).
 *
 * Anonymous-accessible. Mounted at `/pricing` via `featureRegistry.ts`.
 * Wraps content in `<MarketingLayout>`. Copy comes through
 * `useLanguage().t()` under `marketing.pages.pricing.*` (Requirement 31
 * AC 3, Property F-4).
 */

import Link from 'next/link';
import { Check } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { useLanguage } from '@/providers/LanguageProvider';

interface PricingTier {
  /** Translation-key prefix under `marketing.pages.pricing`. */
  key: 'community' | 'professional' | 'enterprise';
  /** Whether to render the tier with the highlighted style. */
  highlighted?: boolean;
  /** Destination route for the tier's CTA. */
  ctaHref: string;
}

const TIERS: readonly PricingTier[] = [
  { key: 'community', ctaHref: '/docs' },
  { key: 'professional', highlighted: true, ctaHref: '/contact' },
  { key: 'enterprise', ctaHref: '/contact' },
] as const;

export default function PricingPage() {
  const { t } = useLanguage();

  return (
    <MarketingLayout pageTitle={t('marketing.pages.pricing.documentTitle')}>
      <main
        data-testid="marketing-pricing-page"
        className="flex flex-1 flex-col"
      >
        {/* Hero */}
        <section className="border-b border-border bg-[hsl(var(--secondary))]">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 lg:px-8 lg:py-24">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t('marketing.pages.pricing.eyebrow')}
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {t('marketing.pages.pricing.heading')}
            </h1>
            <p className="mt-4 max-w-3xl text-lg text-muted-foreground">
              {t('marketing.pages.pricing.lead')}
            </p>
          </div>
        </section>

        {/* Pricing tiers */}
        <section className="bg-background">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:px-8 lg:py-24">
            <div className="grid gap-6 lg:grid-cols-3">
              {TIERS.map((tier) => (
                <Card
                  key={tier.key}
                  data-testid={`pricing-tier-${tier.key}`}
                  className={
                    tier.highlighted
                      ? 'h-full border-2 border-primary shadow-lg'
                      : 'h-full'
                  }
                >
                  <CardContent className="flex h-full flex-col gap-4 p-6">
                    <h2 className="text-xl font-semibold text-foreground">
                      {t(`marketing.pages.pricing.${tier.key}Title`)}
                    </h2>
                    <div>
                      <p className="text-3xl font-semibold tracking-tight text-foreground">
                        {t(`marketing.pages.pricing.${tier.key}Price`)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t(`marketing.pages.pricing.${tier.key}Cadence`)}
                      </p>
                    </div>
                    <ul role="list" className="mt-2 flex-1 space-y-3">
                      {[1, 2, 3, 4].map((featureIndex) => (
                        <li key={featureIndex} className="flex items-start gap-2">
                          <Check
                            className="mt-0.5 h-4 w-4 shrink-0 text-foreground"
                            aria-hidden="true"
                          />
                          <span className="text-sm text-foreground">
                            {t(
                              `marketing.pages.pricing.${tier.key}Feature${featureIndex}`,
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      asChild
                      className="mt-4 w-full"
                      variant={tier.highlighted ? 'default' : 'outline'}
                      data-testid={`pricing-cta-${tier.key}`}
                    >
                      <Link href={tier.ctaHref}>
                        {t(`marketing.pages.pricing.${tier.key}Cta`)}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              {t('marketing.pages.pricing.footnote')}
            </p>
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
