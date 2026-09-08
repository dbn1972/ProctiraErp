import Link from 'next/link';

import { Button } from '@/components/ui/button';

/**
 * Friendly 404 page that points back to high-traffic destinations.
 */
export default function NotFound() {
  return (
    <section className="container flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
        We could not find that page
      </h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        The link may be broken or the page may have moved. Try one of the destinations below.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/contact">Contact us</Link>
        </Button>
      </div>
    </section>
  );
}
