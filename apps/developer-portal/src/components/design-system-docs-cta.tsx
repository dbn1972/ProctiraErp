'use client';

import Link from 'next/link';

import { Button } from '@/lib/design-system';

/** W2-DS-01 — hero CTA built on the shared design-system Button. */
export function DesignSystemDocsCta({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline">
      <Link href={href}>{label}</Link>
    </Button>
  );
}
