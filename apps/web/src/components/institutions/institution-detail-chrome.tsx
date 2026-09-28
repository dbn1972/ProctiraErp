'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Pencil } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { InstitutionReactivateButton } from '@/components/institutions/institution-row-actions';
import { InstitutionTabs } from '@/components/institutions/institution-tabs';

/**
 * Hero actions and section tabs. Hidden on the edit route so Save / Cancel
 * are the only ways through the form, and a tab click cannot drop edits.
 */
export function InstitutionHeroActions(props: { id: string; name: string; inactive: boolean }) {
  const pathname = usePathname();
  if (pathname.endsWith('/edit')) return null;
  const compact = '!h-8 !min-h-8 !min-w-0 !gap-1.5 !px-2.5 !text-xs';
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {props.name !== 'Institution unavailable' ? (
        <InstitutionReactivateButton id={props.id} name={props.name} inactive={props.inactive} />
      ) : null}
      <Button asChild variant="outline" size="sm" className={compact}>
        <Link href={`/institutions/${props.id}/edit`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </Link>
      </Button>
      <Button asChild size="sm" className={compact}>
        <Link href={`/institutions/${props.id}/overview/report`}>
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          School report
        </Link>
      </Button>
    </div>
  );
}

export function InstitutionSectionTabs({ institutionId }: { institutionId: string }) {
  const pathname = usePathname();
  if (pathname.endsWith('/edit')) return null;
  return <InstitutionTabs institutionId={institutionId} />;
}

export function InstitutionGatewayDown({ institutionId }: { institutionId: string }) {
  return (
    <section className="space-y-4" data-testid="institution-gateway-down">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">School unavailable</h1>
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="font-medium text-foreground">The institution service did not respond.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This school could not be loaded, so it is not shown as active. Retry when the service is
          back, or return to the list.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href={`/institutions/${institutionId}/overview`}>Retry</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/institutions">Back to institutions</Link>
        </Button>
      </div>
    </section>
  );
}
