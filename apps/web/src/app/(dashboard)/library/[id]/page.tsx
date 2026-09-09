import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';

import { requireSession } from '@/lib/auth/server';
import { getLibraryItem } from '@/lib/api/library';
import { PlaceHoldForm } from '../_components/place-hold-form';

export const dynamic = 'force-dynamic';

export default async function LibraryTitlePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const item = await getLibraryItem(id);
  if (!item) notFound();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{item.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {item.author ?? 'Unknown author'}
            {item.isbn ? ` · ISBN ${item.isbn}` : ''} · {item.available}/{item.copies} available
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/library">Back to catalog</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Copies</CardTitle>
          <CardDescription>Barcode and accession for scan checkout.</CardDescription>
        </CardHeader>
        <CardContent>
          {item.copyList.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No copies on this title.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {item.copyList.map((copy) => (
                <li
                  key={copy.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="library-copy-row"
                  data-barcode={copy.barcode}
                >
                  <p className="text-sm font-medium text-foreground">{copy.barcode}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {copy.status}
                    {copy.accessionNo ? ` · accession ${copy.accessionNo}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PlaceHoldForm items={[item]} defaultItemId={item.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holds</CardTitle>
          <CardDescription>
            {item.holds.length === 0
              ? 'No holds on this title.'
              : `${item.holds.length} hold${item.holds.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {item.holds.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No holds on this title.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {item.holds.map((hold) => (
                <li
                  key={hold.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="library-hold-row"
                  data-hold-status={hold.status}
                >
                  <p className="text-sm font-medium text-foreground">
                    {hold.status} · position {hold.position}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {hold.studentId ?? hold.patronUserId ?? 'patron'}
                    {hold.expiresAt ? ` · expires ${hold.expiresAt.slice(0, 10)}` : ''}
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
