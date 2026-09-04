import type { ReactNode } from 'react';
import Link from 'next/link';

import { Button } from '@proctira/ui/components';
import { DocumentTitle } from '@/components/DocumentTitle';

/**
 * Shared chrome pieces for marketing Server Components that have no SPA
 * counterpart. Visual language mirrors Task 50.2 marketing pages
 * (secondary hero band, bordered sections, CSS variables) rather than
 * inventing a new palette.
 */

export function MarketingDocumentTitle({ pageTitle }: { pageTitle: string }) {
  return <DocumentTitle pageTitle={pageTitle} />;
}

export function MarketingHero({
  eyebrow,
  heading,
  lead,
  children,
}: {
  eyebrow: string;
  heading: ReactNode;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <section className="border-b border-border bg-[hsl(var(--secondary))]">
      <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-20 lg:px-8 lg:py-24">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          {heading}
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-muted-foreground">{lead}</p>
        {children ? <div className="mt-8 flex flex-wrap gap-3">{children}</div> : null}
      </div>
    </section>
  );
}

export function MarketingSection({
  alt = false,
  children,
  className = '',
}: {
  alt?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border-b border-border ${
        alt ? 'bg-[hsl(var(--secondary))]' : 'bg-background'
      } ${className}`}
    >
      <div className="mx-auto w-full max-w-5xl px-6 py-14 lg:px-8 lg:py-20">
        {children}
      </div>
    </section>
  );
}

export function MarketingSectionHeading({
  kicker,
  title,
  subtitle,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-10 max-w-3xl">
      {kicker ? (
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {kicker}
        </p>
      ) : null}
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-3 text-base text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  );
}

export function MarketingCtaBand({
  heading,
  body,
  primary,
  secondary,
}: {
  heading: ReactNode;
  body: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <section className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-16 lg:px-8 lg:py-20">
        <div className="max-w-3xl space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {heading}
          </h2>
          <p className="text-base opacity-90">{body}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" variant="secondary">
            <Link href={primary.href}>{primary.label}</Link>
          </Button>
          {secondary ? (
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-[hsl(var(--primary-foreground))]/40 bg-transparent text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary-foreground))]/10"
            >
              <Link href={secondary.href}>{secondary.label}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
