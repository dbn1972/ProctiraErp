import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listDeliveryLogs } from '@/lib/api/communication';

import { DeliveryLogTable } from '../_components/delivery-log-table';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readStr(params: Awaited<PageProps['searchParams']>, key: string): string {
  if (!params) return '';
  const v = params[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0] ?? '';
  return '';
}

export default async function DeliveryLogPage(props: PageProps) {
  await requireSession();
  const searchParams = await props.searchParams;
  const channel = readStr(searchParams, 'channel');
  const status = readStr(searchParams, 'status');
  const rows = await listDeliveryLogs({
    channel: channel || undefined,
    status: status || undefined,
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Delivery log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Channel, recipient, status, provider ref. Retry failed rows (sandbox re-send, no live
          WhatsApp).
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
          <CardDescription>
            {rows.length} row{rows.length === 1 ? '' : 's'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="text-sm" htmlFor="dl-channel">
              Channel
              <input
                id="dl-channel"
                name="channel"
                defaultValue={channel}
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="text-sm" htmlFor="dl-status">
              Status
              <select
                id="dl-status"
                name="status"
                defaultValue={status}
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Any</option>
                <option value="queued">queued</option>
                <option value="sent">sent</option>
                <option value="delivered">delivered</option>
                <option value="failed">failed</option>
              </select>
            </label>
            <Button type="submit" variant="outline" size="sm">
              Apply
            </Button>
          </form>
          <DeliveryLogTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
