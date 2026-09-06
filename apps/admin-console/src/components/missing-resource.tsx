import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface MissingResourceProps {
  title: string;
  resourceLabel: string;
  id: string;
  backHref: string;
  backLabel: string;
}

/** Stable empty/error state with h1 when a detail id is unknown. */
export function MissingResource({
  title,
  resourceLabel,
  id,
  backHref,
  backLabel,
}: MissingResourceProps) {
  return (
    <>
      <PageHeader title={title} description={`${resourceLabel} was not found.`} />
      <Alert variant="warning" className="mb-6" data-testid="missing-resource">
        <AlertTitle>Not found</AlertTitle>
        <AlertDescription>
          No {resourceLabel.toLowerCase()} matches{' '}
          <code className="font-mono text-xs">{id}</code>. The gateway may be
          offline, or the id is outside the stub fixture set.
        </AlertDescription>
      </Alert>
      <Button asChild variant="outline">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </>
  );
}
