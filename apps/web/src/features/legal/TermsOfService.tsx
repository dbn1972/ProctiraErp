'use client';

/**
 * TermsOfService — public Terms of Service (Task 50.2).
 *
 * Anonymous-accessible. Mounted at `/legal/terms` via `featureRegistry.ts`.
 * Wraps content in `<MarketingLayout>`. The page heading, document title,
 * and "last updated" label come through `useLanguage().t()`; the body prose
 * stays in English JSX per Property F-4 (Task 48.6) until tenant-translated
 * legal catalogues are commissioned. The Property F-4 lint exception
 * described in Task 50.2 lands with that property test, so when it ships
 * these pages already surface the bodies through `t()` by adding the keys
 * to the catalogues.
 */

import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { useLanguage } from '@/providers/LanguageProvider';

const LAST_UPDATED = 'June 1, 2024';

export default function TermsOfService() {
  const { t } = useLanguage();

  return (
    <MarketingLayout pageTitle={t('marketing.pages.legal.termsTitle')}>
      <main
        data-testid="legal-terms-page"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16 lg:px-8 lg:py-20"
      >
        <header className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            {t('marketing.pages.legal.termsTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('marketing.pages.legal.lastUpdatedLabel')}: {LAST_UPDATED}
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">1. Acceptance of terms</h2>
          <p className="text-base leading-relaxed text-foreground">
            These terms govern access to and use of the ProctiraERP marketing site and the public
            demo tenant. By using the site you agree to be bound by these terms together with the
            linked Privacy Policy. Production tenants operated by ministries or boards have their
            own terms that supersede these for the operational platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">2. Use of the platform</h2>
          <p className="text-base leading-relaxed text-foreground">
            You agree to use the site lawfully and not to attempt to disrupt, reverse engineer, or
            scrape the platform beyond what the public APIs permit. The ProctiraERP source code is
            licensed under its own open source license, which governs reuse and modification of the
            code itself.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">3. Intellectual property</h2>
          <p className="text-base leading-relaxed text-foreground">
            The ProctiraERP name, logo, and marketing copy are the property of the ProctiraERP
            project. The platform source code is licensed separately under the terms in the public
            repository. Tenant content remains the property of the operating ministry, board, or
            institution.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">4. Disclaimer of warranties</h2>
          <p className="text-base leading-relaxed text-foreground">
            The marketing site and the public demo are provided on an "as is" and "as available"
            basis without warranties of any kind, whether express or implied. The ProctiraERP
            project does not warrant that the site will be uninterrupted, error-free, or that demo
            data will be preserved between releases.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">5. Limitation of liability</h2>
          <p className="text-base leading-relaxed text-foreground">
            To the maximum extent permitted by law, the ProctiraERP project is not liable for
            indirect, incidental, special, consequential, or punitive damages arising from use of
            the marketing site or the public demo. Production tenants address liability through
            their own contracts with the operating ministry or board.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">6. Changes</h2>
          <p className="text-base leading-relaxed text-foreground">
            We may update these terms from time to time. Material changes are announced in the
            public source repository and the "Last updated" date above is revised accordingly.
            Continued use of the site after an update constitutes acceptance of the revised terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">7. Contact</h2>
          <p className="text-base leading-relaxed text-foreground">
            Questions about these terms can be sent to{' '}
            <a
              href="mailto:legal@proctira.org"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              legal@proctira.org
            </a>
            .
          </p>
        </section>
      </main>
    </MarketingLayout>
  );
}
