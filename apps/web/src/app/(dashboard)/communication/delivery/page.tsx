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
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { loadStaffLabelMap, loadStudentLabelMap, withPersonLabels } from '@/lib/load-entity-labels';

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
  const [logs, studentLabels, staffLabels] = await Promise.all([
    listDeliveryLogs({
      channel: channel || undefined,
      status: status || undefined,
    }),
    loadStudentLabelMap(),
    loadStaffLabelMap(),
  ]);
  const rows = logs.ok ? logs.items : [];
  // PRC-M083: recipients beyond the first directory page are looked up by id.
  const recipientLabels = Object.fromEntries(
    await withPersonLabels(
      new Map([...studentLabels, ...staffLabels]),
      rows.map((row) => row.recipientId),
    ),
  );

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
            {logs.ok
              ? `${rows.length} row${rows.length === 1 ? '' : 's'}`
              : 'Delivery log unavailable'}
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
                className="mt-1 block h-11 min-h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              />
            </label>
            <label className="text-sm" htmlFor="dl-status">
              Status
              <select
                id="dl-status"
                name="status"
                defaultValue={status}
                className="mt-1 block h-11 min-h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="">Any</option>
                <option value="queued">queued</option>
                <option value="sent">sent</option>
                <option value="delivered">delivered</option>
                <option value="failed">failed</option>
              </select>
            </label>
            <Button type="submit" variant="outline" size="sm" className="min-h-11">
              Apply
            </Button>
          </form>
          {logs.ok ? (
            <DeliveryLogTable rows={rows} recipientLabels={recipientLabels} />
          ) : (
            <ListLoadFailure
              kind={logs.kind}
              status={logs.status}
              returnTo="/communication/delivery"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
