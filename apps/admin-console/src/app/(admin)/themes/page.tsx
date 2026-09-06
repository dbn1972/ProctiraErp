import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { StubDataBanner } from '@/components/stub-data-banner';
import { StatusBadge } from '@/components/ui/status-badge';
import { listThemes } from '@/lib/api/themes';
import { requireRole } from '@/lib/auth/server';
import { formatDate } from '@/lib/utils';

export default async function ThemesPage() {
  await requireRole('themes', '/themes');
  const { themes, source } = await listThemes();

  return (
    <>
      <PageHeader
        title="Theme gallery"
        description="Curated visual themes for tenants. Approve or reject vendor-submitted themes for the marketplace."
      />

      <StubDataBanner source={source} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {themes.map((theme) => {
          const needsReview =
            theme.status === 'submitted' || theme.status === 'in_review';
          return (
            <Card
              key={theme.id}
              className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md"
            >
              <div className="aspect-video w-full bg-gradient-to-br from-[hsl(var(--primary))]/30 to-[hsl(var(--accent))]/30" />
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <Link
                    href={`/themes/${theme.id}`}
                    className="hover:underline"
                  >
                    {theme.name}
                  </Link>
                  <StatusBadge status={theme.status} />
                </CardTitle>
                <CardDescription>
                  {theme.vendor} ·{' '}
                  <span className="font-mono">v{theme.version}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <p className="text-sm text-muted-foreground">
                  {theme.description}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {theme.tokenOverrides} token overrides · submitted{' '}
                  {formatDate(theme.submittedAt)}
                </p>
                <div className="mt-4 flex-1" />
                <Link
                  href={`/themes/${theme.id}`}
                  className="text-sm font-medium text-[hsl(var(--accent))] hover:underline"
                >
                  {needsReview ? 'Review submission →' : 'View theme →'}
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
