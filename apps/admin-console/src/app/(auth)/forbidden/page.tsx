import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * /forbidden — shown when an operator's role is not allowed in the requested
 * area. The audit log records the redirect.
 */
export default function ForbiddenPage({ searchParams }: { searchParams: { area?: string } }) {
  const area = searchParams?.area ?? 'this area';
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardContent className="flex flex-col items-center p-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
            <ShieldAlert className="h-7 w-7" aria-hidden="true" />
          </div>
          <span className="mt-4 rounded bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
            HTTP 403
          </span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground">
            Access denied
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your assigned platform role does not include access to{' '}
            <strong className="text-foreground">{area}</strong>. If you believe this is incorrect,
            contact the security team.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            This attempt was recorded to the audit log.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button asChild variant="secondary">
              <Link href="/">
                <ArrowLeft className="me-2 h-4 w-4" /> Return to dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
