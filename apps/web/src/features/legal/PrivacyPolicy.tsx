'use client';

/**
 * PrivacyPolicy — public Privacy Policy (Task 50.2).
 *
 * Anonymous-accessible. Mounted at `/legal/privacy` via
 * `featureRegistry.ts`. Wraps content in `<MarketingLayout>`. The page
 * heading, document title, and "last updated" label come through
 * `useLanguage().t()`; the body prose stays in English JSX per Property
 * F-4 (Task 48.6) until tenant-translated legal catalogues are
 * commissioned. The Property F-4 lint exception described in Task 50.2
 * lands together with that property test, so when it ships these pages
 * are already structured to surface the bodies through `t()` simply by
 * adding the keys to the catalogues.
 */

import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { useLanguage } from '@/providers/LanguageProvider';

const LAST_UPDATED = 'June 1, 2024';

export default function PrivacyPolicy() {
  const { t } = useLanguage();

  return (
    <MarketingLayout pageTitle={t('marketing.pages.legal.privacyTitle')}>
      <main
        data-testid="legal-privacy-page"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16 lg:px-8 lg:py-20"
      >
        <header className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            {t('marketing.pages.legal.privacyTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('marketing.pages.legal.lastUpdatedLabel')}: {LAST_UPDATED}
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">1. Introduction</h2>
          <p className="text-base leading-relaxed text-foreground">
            ProctiraERP is an open source Education Management Information System operated under
            tenant deployments by ministries, education boards, and school networks. This policy
            explains what personal information the platform processes, why, and the choices the data
            subject has. It applies to the marketing site and the hosted demo tenant operated by the
            ProctiraERP project. Production tenants run by ministries are governed by their own
            published privacy notices.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">2. Information we collect</h2>
          <p className="text-base leading-relaxed text-foreground">
            On marketing pages we collect only what is necessary to operate the site: anonymized
            request logs, basic device and browser metadata, and any contact details you choose to
            submit through forms or email links. We do not place advertising or cross-site tracking
            cookies. Production tenants collect operational data (student records, staff records,
            attendance, assessments, and similar) under their own lawful basis and disclose it in
            their own privacy notice.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">3. How we use information</h2>
          <p className="text-base leading-relaxed text-foreground">
            Aggregated and anonymized site metrics help us improve the documentation and the
            marketing experience. Contact submissions are used solely to respond to the inquiry and
            are retained only as long as necessary to close the conversation, after which they are
            deleted or archived according to our records-retention schedule.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">4. Sharing and disclosure</h2>
          <p className="text-base leading-relaxed text-foreground">
            We do not sell personal information. Limited processors handle specific functions (email
            delivery, infrastructure hosting, error monitoring) under written data-processing
            agreements. We disclose information only as required by law, with explicit consent, or
            as necessary to operate and secure the platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">5. Your rights</h2>
          <p className="text-base leading-relaxed text-foreground">
            Depending on jurisdiction you may request access, correction, erasure, restriction,
            portability, or objection regarding your personal information. Email{' '}
            <a
              href="mailto:privacy@proctira.org"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              privacy@proctira.org
            </a>{' '}
            with your request. For data held inside a production tenant, requests should be
            addressed to the operating ministry or board.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">6. Contact</h2>
          <p className="text-base leading-relaxed text-foreground">
            Questions about this policy can be sent to{' '}
            <a
              href="mailto:privacy@proctira.org"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              privacy@proctira.org
            </a>
            . Updates to this notice are versioned in the public source repository and the "Last
            updated" date above always reflects the most recent change.
          </p>
        </section>
      </main>
    </MarketingLayout>
  );
}
