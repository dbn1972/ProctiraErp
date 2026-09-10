import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { MissingResource } from '@/components/missing-resource';
import { StubDataBanner } from '@/components/stub-data-banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/input';
import { getTheme } from '@/lib/api/themes';
import { requireRole } from '@/lib/auth/server';
import { formatDateTime } from '@/lib/utils';

import { themeDecisionAction } from '../actions';

export default async function ThemeDetailPage({ params }: { params: { id: string } }) {
  await requireRole('themes', `/themes/${params.id}`);
  const { theme, source } = await getTheme(params.id);
  if (!theme) {
    return (
      <MissingResource
        title="Theme"
        resourceLabel="Theme"
        id={params.id}
        backHref="/themes"
        backLabel="Back to themes"
      />
    );
  }

  return (
    <>
      <PageHeader
        title={theme.name}
        description={`${theme.vendor} · v${theme.version}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/themes">Back to themes</Link>
          </Button>
        }
      />

      <StubDataBanner source={source} />

      <div className="mb-6 flex items-center gap-3">
        <StatusBadge status={theme.status} />
        <span className="text-sm text-muted-foreground">
          Submitted {formatDateTime(theme.submittedAt)} · {theme.tokenOverrides} token overrides
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              Generated render of the theme tokens applied to the platform shell.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border">
              <div className="aspect-video w-full rounded-md bg-gradient-to-br from-[hsl(var(--primary))]/20 to-[hsl(var(--accent))]/20" />
              <p className="border-t border-border p-3 text-xs text-muted-foreground">
                Preview URL: <code className="font-mono">{theme.previewUrl}</code>
              </p>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{theme.description}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
            <CardDescription>Reviewer notes are recorded with the decision.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={themeDecisionAction} className="space-y-3">
              <input type="hidden" name="id" value={theme.id} />
              <Textarea name="reason" required minLength={10} placeholder="Reviewer notes…" />
              <div className="grid grid-cols-2 gap-2">
                <Button type="submit" name="action" value="approve">
                  Approve
                </Button>
                <Button type="submit" name="action" value="reject" variant="destructive">
                  Reject
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
