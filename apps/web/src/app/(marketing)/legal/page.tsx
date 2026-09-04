import Link from 'next/link';

import { Card, CardContent } from '@proctira/ui/components';
import { ArrowRight, Cookie, FileText, Scale, ShieldCheck } from 'lucide-react';

import {
  MarketingCtaBand,
  MarketingDocumentTitle,
  MarketingHero,
  MarketingSection,
} from '@/features/marketing/sections/MarketingStaticChrome';

const DOCS = [
  {
    href: '/legal/privacy',
    title: 'Privacy Policy',
    body: 'What personal data we collect, why we collect it, who sees it, and the rights you hold under applicable privacy law.',
    updated: 'Last updated June 1, 2024',
    Icon: ShieldCheck,
  },
  {
    href: '/legal/terms',
    title: 'Terms of Service',
    body: 'The agreement that governs access to our website and cloud services — eligibility, acceptable use, and how the open-source licence fits in.',
    updated: 'Last updated June 1, 2024',
    Icon: FileText,
  },
  {
    href: '/legal/cookies',
    title: 'Cookie Policy',
    body: 'The small set of cookies our website uses, what each one does, how long it lasts, and how to change your preferences.',
    updated: 'Last updated March 2, 2026',
    Icon: Cookie,
  },
  {
    href: '/security/compliance',
    title: 'Compliance & trust',
    body: 'How we meet DPDP Act 2023, GDPR, FERPA-aligned, and WCAG 2.2 AA obligations — with our default data-processing register.',
    updated: 'Last updated May 28, 2026',
    Icon: Scale,
  },
] as const;

/**
 * Legal hub — App Router page sourced from redesign/website/legal.html.
 */
export default function LegalHubPage() {
  return (
    <>
      <MarketingDocumentTitle pageTitle="Legal" />
      <main data-testid="marketing-legal-hub-page" className="flex flex-1 flex-col">
        <MarketingHero
          eyebrow="Legal"
          heading={
            <>
              Legal <span className="text-primary">notices</span>
            </>
          }
          lead="Everything that governs your use of ProctiraERP — written to be read, not just filed. Each document includes a plain-language summary."
        />

        <MarketingSection>
          <div className="grid gap-6 md:grid-cols-2">
            {DOCS.map(({ href, title, body, updated, Icon }) => (
              <Link key={href} href={href} className="group block h-full">
                <Card className="h-full transition-colors group-hover:border-foreground/20">
                  <CardContent className="flex h-full flex-col gap-3 p-6">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(var(--secondary))] text-foreground">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {title}
                    </h2>
                    <p className="text-sm text-muted-foreground">{body}</p>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
                      <span>{updated}</span>
                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                        Read
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="mt-10 rounded-lg border border-border bg-[hsl(var(--secondary))] p-6">
            <h3 className="text-lg font-semibold text-foreground">
              Trademarks, copyright &amp; takedowns
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              &quot;ProctiraERP&quot; and related marks are trademarks of their
              respective owners. Platform source code is licensed under
              Apache-2.0; content on this website is © {new Date().getFullYear()}{' '}
              unless noted otherwise. Reports of trademark misuse or IP
              takedown notices can be sent to{' '}
              <a
                className="font-medium text-foreground underline-offset-4 hover:underline"
                href="mailto:legal@proctira.org"
              >
                legal@proctira.org
              </a>
              .
            </p>
          </div>
        </MarketingSection>

        <MarketingCtaBand
          heading="Can't find what your legal team needs?"
          body="We respond to procurement questionnaires, DPA requests, and bespoke contract reviews for government and institutional customers."
          primary={{ href: '/contact', label: 'Contact our legal desk' }}
          secondary={{
            href: '/security/compliance',
            label: 'View compliance details',
          }}
        />
      </main>
    </>
  );
}
