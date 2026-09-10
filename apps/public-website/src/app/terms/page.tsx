import type { Metadata } from 'next';
import { CalendarClock } from 'lucide-react';

import { LegalProse } from '@/components/layout/legal-prose';
import { PageHero } from '@/components/layout/page-hero';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The legal terms that govern access to the ProctiraERP public website and services.',
  alternates: { canonical: '/terms' },
};

/**
 * Boilerplate Terms of Service. Operators must replace placeholders and
 * insert their commercial terms before public launch.
 */
export default function TermsPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Terms of Service"
        description="The terms that govern access to the ProctiraERP public website and services."
      />
      <section className="container py-16">
        <div className="mx-auto mb-8 flex max-w-3xl items-center gap-2.5 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
          <CalendarClock aria-hidden="true" className="h-4 w-4 flex-shrink-0" />
          Effective date set by the operator — review and update before public launch.
        </div>
        <LegalProse>
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the
            ProctiraERP public website and any related services (collectively, the
            &ldquo;Services&rdquo;). By using the Services you agree to these Terms.
          </p>

          <h2>Eligibility</h2>
          <p>
            You must have the legal capacity to enter into these Terms in your jurisdiction, and you
            must not be prohibited from using the Services under applicable law.
          </p>

          <h2>Accounts</h2>
          <p>
            If you create an account or are granted access by your institution, you are responsible
            for keeping your credentials confidential and for all activity under your account.
          </p>

          <h2>Acceptable use</h2>
          <ul>
            <li>Do not interfere with the integrity or performance of the Services.</li>
            <li>Do not attempt unauthorized access to data, systems, or accounts.</li>
            <li>Do not use the Services to violate applicable laws or third-party rights.</li>
            <li>Do not reverse engineer non-open components except as permitted by law.</li>
          </ul>

          <h2>Open-source components</h2>
          <p>
            ProctiraERP is, in significant part, open-source software. Source components are
            licensed under their respective licenses, which apply to your use of those components.
            Commercial offerings, when applicable, are governed by a separate written agreement.
          </p>

          <h2>Intellectual property</h2>
          <p>
            The ProctiraERP name, marks, and trade dress are owned by their respective rights
            holders. Nothing in these Terms grants you a license to use those marks except as
            expressly permitted.
          </p>

          <h2>Disclaimers</h2>
          <p>
            The Services are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
            warranties of any kind, either express or implied, to the maximum extent permitted by
            law. Tenants and operators are responsible for configuring the platform appropriately
            for their users.
          </p>

          <h2>Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, we are not liable for indirect, incidental,
            special, consequential, or punitive damages arising from your use of the Services.
          </p>

          <h2>Termination</h2>
          <p>
            We may suspend or terminate access if you violate these Terms or if required by law. You
            may stop using the Services at any time.
          </p>

          <h2>Governing law</h2>
          <p>
            These Terms are governed by the laws of the jurisdiction in which the operator of these
            Services is established, without regard to conflict-of-laws principles. Operators must
            replace this section with the applicable jurisdiction.
          </p>

          <h2>Changes to these Terms</h2>
          <p>
            We may update these Terms occasionally. Material changes will be communicated on our
            website or directly to customers.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about these Terms? Contact{' '}
            <a href="mailto:legal@proctira.org">legal@proctira.org</a>.
          </p>
        </LegalProse>
      </section>
    </>
  );
}
