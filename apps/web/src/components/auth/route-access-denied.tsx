import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';

export interface RouteAccessDeniedProps {
  title?: string;
  description?: string;
  returnHref?: string;
  returnLabel?: string;
}

export function RouteAccessDenied({
  title = 'Access denied',
  description = 'You do not have permission to view this page. Contact your administrator if you need access.',
  returnHref = '/',
  returnLabel = 'Return to dashboard',
}: RouteAccessDeniedProps) {
  return (
    <Card role="alert" data-testid="route-access-denied">
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <div className="rounded-lg bg-destructive/10 p-2 text-destructive">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={returnHref}>{returnLabel}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
