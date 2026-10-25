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

import { LegalDocumentChrome } from '@/components/layout/LegalDocumentChrome';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { useLanguage } from '@/providers/LanguageProvider';

const LAST_UPDATED = 'October 25, 2026';

/**
 * @param chrome `'marketing'` keeps the original `<MarketingLayout>` wrapper, which the
 *   marketing-page suite asserts. `'minimal'` is what the routed `/legal/*` pages use:
 *   `<MarketingLayout>`'s header and footer carry 45 links with no route in this app, and
 *   exposing them on a consent document is worse than a plain page. See
 *   `LegalDocumentChrome`.
 */
export default function PrivacyPolicy({
  chrome = 'marketing',
}: { chrome?: 'marketing' | 'minimal' } = {}) {
  const { t } = useLanguage();
  const Chrome = chrome === 'minimal' ? LegalDocumentChrome : MarketingLayout;

  return (
    <Chrome pageTitle={t('marketing.pages.legal.privacyTitle')}>
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

        {/* PRC-L262 / Decision D5 guardrail: visible draft marker; no claim of legal compliance. */}
        <p
          role="note"
          data-testid="legal-draft-notice"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
        >
          <strong>Draft — pending legal review.</strong> This notice is modelled on India&apos;s
          Digital Personal Data Protection Act, 2023 (DPDP) and has not been reviewed by counsel.
        </p>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">
            1. Who we are: data fiduciary and data processor
          </h2>
          <p className="text-base leading-relaxed text-foreground">
            The educational institution that uses ProctiraERP is the Data Fiduciary for the personal
            data it records. The platform operator is a Data Processor that acts on the
            institution&apos;s documented instructions.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">2. Personal data we process</h2>
          <p className="text-base leading-relaxed text-foreground">
            Student, guardian and staff identity and contact details, academic records, attendance,
            assessment, fee and payment records, and health records where the institution records
            them.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">3. Purposes</h2>
          <p className="text-base leading-relaxed text-foreground">
            Delivering school information services: enrolment, academics, attendance, assessment,
            fees, communication, and statutory reporting.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">4. Lawful basis</h2>
          <p className="text-base leading-relaxed text-foreground">
            Performance of the education service and the institution&apos;s legal obligations, and
            consent where it is required (for example, certain communications).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">5. Children&apos;s data</h2>
          <p className="text-base leading-relaxed text-foreground">
            Children&apos;s data is processed on behalf of the institution. Guardian consent is the
            default basis for a minor&apos;s data, consistent with the DPDP Act&apos;s treatment of
            children. There is no behavioural tracking of, or targeted advertising to, children.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">6. Data principal rights</h2>
          <p className="text-base leading-relaxed text-foreground">
            You can ask for access, correction, completion and erasure of your personal data, for
            grievance redressal, and to nominate another person to exercise these rights. These
            rights are exercised through your institution.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">7. Grievance and DPO contact</h2>
          <p className="text-base leading-relaxed text-foreground">
            [institution DPO contact — set by your institution]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">8. Retention</h2>
          <p className="text-base leading-relaxed text-foreground">
            Personal data is kept only as long as it is needed for the purposes above, or as
            required by law. The default schedule below is configurable per institution and is
            pending confirmation by counsel.
          </p>
          <ul className="list-disc space-y-1 ps-6 text-base leading-relaxed text-foreground">
            <li>Audit logs: 24 months (not below 12 months).</li>
            <li>Student academic records: duration of enrolment plus 7 years.</li>
            <li>Fee and payment records: 8 years.</li>
            <li>Health records: duration of enrolment, and longer where the law requires.</li>
            <li>Communication logs: 18 months.</li>
            <li>Consent records: life of the relationship plus 3 years.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">9. Security</h2>
          <p className="text-base leading-relaxed text-foreground">
            Tenant isolation, access controls, encryption in transit, and audit logging.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">10. Sharing and disclosure</h2>
          <p className="text-base leading-relaxed text-foreground">
            We do not sell personal information. Limited processors handle specific functions (email
            delivery, infrastructure hosting, error monitoring) under written data-processing
            agreements. We disclose information only as required by law, with explicit consent, or
            as necessary to operate and secure the platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">11. Contact</h2>
          <p className="text-base leading-relaxed text-foreground">
            Questions about this policy can be sent to{' '}
            <a
              href="mailto:privacy@proctira.org"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              privacy@proctira.org
            </a>
            . Updates to this notice are versioned in the public source repository and the
            &quot;Last updated&quot; date above always reflects the most recent change.
          </p>
        </section>
      </main>
    </Chrome>
  );
}
