import type { Metadata } from 'next';

import { LegalProse } from '@/components/layout/legal-prose';
import { PageHero } from '@/components/layout/page-hero';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How ProctiraERP collects, uses, and protects information across our website and services.',
  alternates: { canonical: '/privacy' },
};

/**
 * Boilerplate Privacy Policy. Tenants and operators must review and adjust
 * to match their lawful basis, processors, and jurisdiction before public
 * launch.
 */
export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Privacy Policy"
        description="Effective date: review and update before public launch."
      />
      <section className="container py-16">
        <LegalProse>
          <p>
            This Privacy Policy describes how ProctiraERP (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects,
            uses, and discloses information when you use the ProctiraERP public
            website and services. It is provided as a starting template and
            should be tailored to your jurisdiction, legal basis, and processor
            agreements before publication.
          </p>

          <h2>Information we collect</h2>
          <p>
            We collect information that you provide to us directly (such as
            contact form submissions and support inquiries), information
            collected automatically when you use our services (such as device
            and usage data), and information from third parties (such as
            authentication providers when you choose to sign in).
          </p>

          <h2>How we use information</h2>
          <ul>
            <li>To operate, secure, and improve the platform.</li>
            <li>To respond to inquiries and provide customer support.</li>
            <li>To communicate updates relevant to the services you use.</li>
            <li>To meet legal, regulatory, and contractual obligations.</li>
          </ul>

          <h2>Lawful basis</h2>
          <p>
            Where required by law (for example under the GDPR), we process
            personal data on the basis of consent, contractual necessity,
            legitimate interests, or compliance with a legal obligation.
            Tenants are responsible for the lawful basis applicable to their
            end users (students, staff, parents, and others).
          </p>

          <h2>Sharing and processors</h2>
          <p>
            We share information with service providers who process data on
            our behalf under written agreements. We do not sell personal
            information. A current sub-processor list is available on
            request.
          </p>

          <h2>International transfers</h2>
          <p>
            Where data is transferred internationally, we rely on appropriate
            safeguards such as Standard Contractual Clauses or equivalent
            mechanisms. Tenants can configure data residency to keep data in
            a specific region or country.
          </p>

          <h2>Data subject rights</h2>
          <p>
            Subject to applicable law, you may have rights to access, correct,
            export, restrict, or delete your personal data. Contact{' '}
            <a href="mailto:privacy@proctira.org">privacy@proctira.org</a> to
            exercise these rights.
          </p>

          <h2>Retention</h2>
          <p>
            We retain personal data only as long as needed to provide the
            services, meet legal obligations, and resolve disputes. Tenants
            configure retention for their end-user records.
          </p>

          <h2>Security</h2>
          <p>
            We use technical and organizational safeguards described in our
            <a href="/security">Security</a> page. No system is perfectly
            secure; report suspected incidents to{' '}
            <a href="mailto:security@proctira.org">security@proctira.org</a>.
          </p>

          <h2>Children</h2>
          <p>
            ProctiraERP is used by educational institutions that may collect
            information about students under applicable child-protection
            laws. Direct relationships with minors run through the
            responsible institution, not through us.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            We may update this policy from time to time. Material changes
            will be communicated through our website or directly to
            customers.
          </p>

          <h2>Contact</h2>
          <p>
            Questions? Contact{' '}
            <a href="mailto:privacy@proctira.org">privacy@proctira.org</a>.
          </p>
        </LegalProse>
      </section>
    </>
  );
}
