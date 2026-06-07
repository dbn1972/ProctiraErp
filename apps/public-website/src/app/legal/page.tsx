import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Cookie,
  FileText,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';

import { PageHero } from '@/components/layout/page-hero';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Legal notices',
  description:
    'Legal notices including intellectual property, trademarks, and acceptable use guidance for ProctiraERP.',
  alternates: { canonical: '/legal' },
};

interface LegalDoc {
  readonly icon: typeof FileText;
  readonly href: string;
  readonly title: string;
  readonly summary: string;
  readonly cta: string;
}

const LEGAL_DOCS: ReadonlyArray<LegalDoc> = [
  {
    icon: ShieldQuestion,
    href: '/privacy',
    title: 'Privacy Policy',
    summary:
      'What personal data we collect, why we collect it, who sees it, and the rights you hold over your information.',
    cta: 'Read policy',
  },
  {
    icon: FileText,
    href: '/terms',
    title: 'Terms of Service',
    summary:
      'The agreement that governs access to our website and cloud services — eligibility, acceptable use, and how the open-source licence fits in.',
    cta: 'Read terms',
  },
  {
    icon: Cookie,
    href: '/cookies',
    title: 'Cookie Policy',
    summary:
      'The small set of cookies our website uses, what each one does, how long it lasts, and how to change your preferences at any time.',
    cta: 'Read policy',
  },
  {
    icon: ShieldCheck,
    href: '/compliance',
    title: 'Compliance & trust',
    summary:
      'How we meet DPDP Act 2023, GDPR, FERPA-aligned, and WCAG 2.1 AA obligations — with our default data-processing register.',
    cta: 'View compliance',
  },
];

/**
 * Legal hub page.
 *
 * A directory of legal documents with plain-language summaries, a
 * trademarks/copyright/takedown notice, and a navy call-to-action.
 */
export default function LegalPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Legal notices"
        description="Everything that governs your use of ProctiraERP — written to be read, not just filed. Each document includes a plain-language summary."
      />

      <section className="container py-16" aria-label="Legal documents">
        <div className="grid gap-6 md:grid-cols-2">
          {LEGAL_DOCS.map((doc) => {
            const Icon = doc.icon;
            return (
              <Link
                key={doc.href}
                href={doc.href}
                className="group flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <h2 className="text-lg font-bold tracking-tight text-foreground">
                    {doc.title}
                  </h2>
                </div>
                <p className="mt-4 flex-1 leading-relaxed text-muted-foreground">
                  {doc.summary}
                </p>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:underline">
                  {doc.cta}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-secondary/30 p-6">
          <h2 className="text-lg font-bold tracking-tight text-foreground">
            Trademarks, copyright & takedowns
          </h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            &ldquo;ProctiraERP&rdquo; and the ProctiraERP logo are trademarks
            of their respective owners. Platform source code is licensed under
            its respective open-source licences; content on this website is
            provided under the ProctiraERP public-content licence unless noted
            otherwise. Reports of trademark misuse can be sent to{' '}
            <a
              className="font-medium text-primary hover:underline"
              href="mailto:abuse@proctira.org"
            >
              abuse@proctira.org
            </a>
            ; intellectual-property takedown notices with sufficient detail to{' '}
            <a
              className="font-medium text-primary hover:underline"
              href="mailto:legal@proctira.org"
            >
              legal@proctira.org
            </a>
            .
          </p>
        </div>
      </section>

      {/* CTA */}
      <section
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="legal-cta-heading"
      >
        <div className="container py-20 text-center">
          <h2
            id="legal-cta-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Can&apos;t find what your legal team needs?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            We respond to procurement questionnaires, DPA requests, and bespoke
            contract reviews for government and institutional customers.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/contact">Contact our legal desk</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/compliance">View compliance details</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
