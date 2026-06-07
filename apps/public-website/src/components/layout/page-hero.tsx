import { cn } from '@/lib/utils';

interface PageHeroProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly className?: string;
}

/**
 * Standardized hero for legal/info pages.
 *
 * Uses an `<h1>` so each page has exactly one top-level heading and the
 * accessible page title is discoverable via heading navigation.
 */
export function PageHero({ eyebrow, title, description, className }: PageHeroProps) {
  return (
    <section
      className={cn(
        'border-b border-border bg-gradient-to-b from-secondary/60 to-background',
        className,
      )}
    >
      <div className="container py-16 md:py-20">
        {eyebrow ? (
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </section>
  );
}
