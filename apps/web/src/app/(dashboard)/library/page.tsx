/**
 * Library catalog (Server Component).
 */
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getTranslations } from 'next-intl/server';

import { requireSession } from '@/lib/auth/server';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { getListFailureCopy } from '@/components/route-state/list-failure-copy';
import { listLibraryItems } from '@/lib/api/library';
import { LibraryClearanceForm } from './_components/clearance-form';
import { IsbnImportForm } from './_components/isbn-import-form';
import { NewLibraryItemForm } from './_components/new-item-form';

export const dynamic = 'force-dynamic';

export default async function LibraryCatalogPage() {
  await requireSession();
  const [t, itemsResult] = await Promise.all([getTranslations('library'), listLibraryItems()]);

  // The catalogue *is* this page. An empty shelf is plausible on a new tenant, which is
  // exactly why a denial must not be allowed to look like one.
  if (!itemsResult.ok) {
    return (
      <div className="space-y-6 p-6">
        <ListLoadFailure
          kind={itemsResult.kind}
          status={itemsResult.status}
          requestId={itemsResult.requestId}
          returnTo="/library"
          copy={await getListFailureCopy()}
        />
      </div>
    );
  }
  const items = itemsResult.items;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/library/opac">OPAC</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/library/circulation">{t('circulation')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/library/holds">Holds</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/library/overdues">{t('overdues')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/library/fines">Fines</Link>
          </Button>
        </div>
      </div>

      <NewLibraryItemForm />
      <IsbnImportForm />
      <LibraryClearanceForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('catalog')}</CardTitle>
          <CardDescription>{t('itemCount', { count: items.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t('noHoldings')}
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="library-item-row"
                >
                  <p className="text-sm font-medium text-foreground">
                    <Link
                      href={`/library/${item.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {item.title}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.author ?? t('unknownAuthor')}
                    {item.isbn ? ` · ${t('isbn', { isbn: item.isbn })}` : ''} ·{' '}
                    {t('availability', { available: item.available, copies: item.copies })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
