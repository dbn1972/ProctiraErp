import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { listThemes } from '@/lib/api/themes';
import { requireRole } from '@/lib/auth/server';
import { formatDate } from '@/lib/utils';

export default async function ThemesPage() {
  await requireRole('themes', '/themes');
  const { themes } = await listThemes();

  return (
    <>
      <PageHeader
        title="Theme review"
        description="Approve or reject vendor-submitted themes for the marketplace."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {themes.map((theme) => (
          <Link key={theme.id} href={`/themes/${theme.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <div className="aspect-video w-full rounded-t-lg bg-gradient-to-br from-[hsl(var(--primary))]/30 to-[hsl(var(--accent))]/30" />
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{theme.name}</span>
                  <StatusBadge status={theme.status} />
                </CardTitle>
                <CardDescription>
                  {theme.vendor} · v{theme.version}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {theme.description}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {theme.tokenOverrides} token overrides · submitted{' '}
                  {formatDate(theme.submittedAt)}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
