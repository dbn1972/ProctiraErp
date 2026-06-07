import type { Metadata } from 'next';
import { CalendarClock } from 'lucide-react';

import { LegalProse } from '@/components/layout/legal-prose';
import { PageHero } from '@/components/layout/page-hero';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description:
    'How ProctiraERP uses cookies and similar technologies on our website.',
  alternates: { canonical: '/cookies' },
};

/**
 * Boilerplate Cookie Policy. Operators must update with the actual cookies
 * set by their deployment before publication.
 */
export default function CookiesPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Cookie Policy"
        description="How we use cookies and similar technologies on our website."
      />
      <section className="container py-16">
        <div className="mx-auto mb-8 flex max-w-3xl items-center gap-2.5 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
          <CalendarClock aria-hidden="true" className="h-4 w-4 flex-shrink-0" />
          Applies to proctira.org and its subdomains — review and update before
          public launch.
        </div>
        <LegalProse>
          <p>
            This Cookie Policy explains how the ProctiraERP public website and
            services use cookies and similar technologies. It complements our{' '}
            <a href="/privacy">Privacy Policy</a>.
          </p>

          <h2>What are cookies?</h2>
          <p>
            Cookies are small text files that a website stores on your
            device. They allow a site to remember your actions and
            preferences over time so you do not have to repeat them.
          </p>

          <h2>How we use cookies</h2>
          <ul>
            <li>
              <strong>Strictly necessary</strong> cookies enable core site
              functions such as security, network management, and
              accessibility. These cannot be turned off.
            </li>
            <li>
              <strong>Functional</strong> cookies remember preferences such
              as language and region.
            </li>
            <li>
              <strong>Analytics</strong> cookies, where enabled, help us
              understand how visitors use the site so we can improve it.
              These are only set with your consent where required.
            </li>
          </ul>

          <h2>Managing cookies</h2>
          <p>
            You can control cookies through your browser settings or, where
            offered, via the consent banner on this site. Blocking some types
            of cookies may impact your experience.
          </p>

          <h2>Do Not Track</h2>
          <p>
            We respect Do Not Track signals where required by law or where
            our cookie consent surface offers an explicit opt-out.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            We may update this policy as our cookie usage changes. Material
            updates will be communicated on this page.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about cookies? Contact{' '}
            <a href="mailto:privacy@proctira.org">privacy@proctira.org</a>.
          </p>
        </LegalProse>
      </section>
    </>
  );
}
