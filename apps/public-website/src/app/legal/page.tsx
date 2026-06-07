import type { Metadata } from 'next';

import { LegalProse } from '@/components/layout/legal-prose';
import { PageHero } from '@/components/layout/page-hero';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Legal notices',
  description:
    'Legal notices including intellectual property, trademarks, and acceptable use guidance for ProctiraERP.',
  alternates: { canonical: '/legal' },
};

/**
 * Generic Legal page covering trademarks, IP, third-party notices, and
 * pointers to other legal documents on the site.
 */
export default function LegalPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Legal notices"
        description="Trademarks, intellectual property, and third-party attribution."
      />
      <section className="container py-16">
        <LegalProse>
          <h2>Trademarks</h2>
          <p>
            &ldquo;ProctiraERP&rdquo; and the ProctiraERP logo are trademarks of their
            respective owners. Other product, service, and company names
            mentioned on this site are the property of their respective
            owners. Use of any such mark does not imply endorsement.
          </p>

          <h2>Copyright</h2>
          <p>
            Content on this website, except as otherwise noted, is provided
            under the ProctiraERP public-content license. The platform&rsquo;s source
            code is available under the open-source licenses indicated in
            each repository.
          </p>

          <h2>Third-party software</h2>
          <p>
            ProctiraERP includes third-party software components, each licensed
            under its respective terms. Attribution and license texts are
            included in the source distribution. A consolidated NOTICE file
            is published with each release.
          </p>

          <h2>Acceptable use</h2>
          <p>
            Use of the public website is subject to the{' '}
            <a href="/terms">Terms of Service</a> and{' '}
            <a href="/privacy">Privacy Policy</a>. Reports of misuse can be
            sent to{' '}
            <a href="mailto:abuse@proctira.org">abuse@proctira.org</a>.
          </p>

          <h2>DMCA / IP takedown</h2>
          <p>
            If you believe content on this website infringes your
            intellectual property rights, please send a notice to{' '}
            <a href="mailto:legal@proctira.org">legal@proctira.org</a> with
            sufficient detail to identify the work and the alleged
            infringement.
          </p>

          <h2>Other legal documents</h2>
          <ul>
            <li>
              <a href="/privacy">Privacy Policy</a>
            </li>
            <li>
              <a href="/terms">Terms of Service</a>
            </li>
            <li>
              <a href="/cookies">Cookie Policy</a>
            </li>
            <li>
              <a href="/security">Security</a>
            </li>
            <li>
              <a href="/compliance">Compliance and trust</a>
            </li>
          </ul>
        </LegalProse>
      </section>
    </>
  );
}
