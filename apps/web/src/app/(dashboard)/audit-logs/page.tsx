/**
 * Audit logs — tenant audit trail viewer (Server Component, G-727).
 *
 * Reads `GET /api/v1/audit-logs` (platform scope) with entity/user/operation
 * and date filters carried in the URL so views are shareable and the page is
 * fully server-rendered (no client fetch, works without JS).
 */
import { ScrollText } from 'lucide-react';

import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { DocumentTitle } from '@/components/DocumentTitle';
import {
  buildHref,
  PlatformPagination,
  PlatformSurfaceState,
  readPage,
  readParam,
  type SearchParams,
} from '@/components/platform/PlatformSurfaceState';
import { listAuditLogs, type AuditLogEntry } from '@/lib/api/platform.server';

export const dynamic = 'force-dynamic';

const OPERATIONS = ['CREATE', 'UPDATE', 'DELETE'] as const;

const OPERATION_VARIANT: Record<string, 'success' | 'default' | 'destructive' | 'secondary'> = {
  CREATE: 'success',
  UPDATE: 'default',
  DELETE: 'destructive',
};

const INPUT_CLASS = 'h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground';

/** The gateway validates dates as `YYYY-MM-DD`; anything else is dropped rather than 400-ing the page. */
function toApiDate(date: string | undefined): string | undefined {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(d);
}

export default async function AuditLogsPage({ searchParams }: { searchParams?: SearchParams }) {
  const entityType = readParam(searchParams, 'entityType');
  const entityId = readParam(searchParams, 'entityId');
  const userId = readParam(searchParams, 'userId');
  const operation = readParam(searchParams, 'operation');
  const from = readParam(searchParams, 'from');
  const to = readParam(searchParams, 'to');
  const page = readPage(searchParams);

  const result = await listAuditLogs({
    entityType,
    entityId,
    userId,
    operation,
    startDate: toApiDate(from),
    endDate: toApiDate(to),
    page,
    pageSize: 25,
  });
  const entries = result.data;
  const filters = { entityType, entityId, userId, operation, from, to };
  const filtered = Object.values(filters).some(Boolean);

  return (
    <section
      aria-labelledby="audit-logs-heading"
      className="space-y-6"
      data-testid="audit-logs-page"
    >
      <DocumentTitle pageTitle="Audit logs" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="audit-logs-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Audit logs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who changed what, when, and from where — immutable trail for this tenant.
          </p>
        </div>
        {result.meta.totalItems > 0 ? (
          <p className="text-sm text-muted-foreground">
            {result.meta.totalItems.toLocaleString()} matching entr
            {result.meta.totalItems === 1 ? 'y' : 'ies'}
          </p>
        ) : null}
      </div>

      <PlatformSurfaceState surface="Audit logs" result={result} />

      <form
        method="get"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Filter audit logs"
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Entity type
          <input
            name="entityType"
            defaultValue={entityType ?? ''}
            placeholder="e.g. student"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Entity id
          <input name="entityId" defaultValue={entityId ?? ''} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          User id
          <input name="userId" defaultValue={userId ?? ''} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Operation
          <select name="operation" defaultValue={operation ?? ''} className={INPUT_CLASS}>
            <option value="">Any</option>
            {OPERATIONS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          From
          <input type="date" name="from" defaultValue={from ?? ''} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          To
          <input type="date" name="to" defaultValue={to ?? ''} className={INPUT_CLASS} />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2">
          <button
            type="submit"
            className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Apply filters
          </button>
          {filtered ? (
            <a
              href="/audit-logs"
              className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-semibold text-foreground"
            >
              Clear
            </a>
          ) : null}
        </div>
      </form>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <EmptyState filtered={filtered} />
          ) : (
            <Table aria-label="Audit log entries">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="ps-4 font-semibold">When (UTC)</TableHead>
                  <TableHead className="font-semibold">Operation</TableHead>
                  <TableHead className="font-semibold">Entity</TableHead>
                  <TableHead className="font-semibold">Actor</TableHead>
                  <TableHead className="font-semibold">IP</TableHead>
                  <TableHead className="pe-4 font-semibold">Changed fields</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PlatformPagination
        meta={result.meta}
        itemLabel="entries"
        hrefFor={(p) => buildHref('/audit-logs', { ...filters, page: p })}
      />
    </section>
  );
}

function EntryRow({ entry }: { entry: AuditLogEntry }) {
  return (
    <TableRow data-testid="audit-log-row">
      <TableCell className="ps-4 whitespace-nowrap tabular-nums">
        <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
      </TableCell>
      <TableCell>
        <Badge variant={OPERATION_VARIANT[entry.operation] ?? 'secondary'}>{entry.operation}</Badge>
      </TableCell>
      <TableCell>
        <p className="font-semibold text-foreground">{entry.entityType}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{entry.entityId}</p>
      </TableCell>
      <TableCell>
        <p className="text-foreground">{entry.userName}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{entry.userId}</p>
      </TableCell>
      <TableCell className="font-mono text-xs">{entry.ipAddress ?? '—'}</TableCell>
      <TableCell className="pe-4">
        {entry.changedFields.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex max-w-md flex-wrap gap-1">
            {entry.changedFields.map((field) => (
              <Badge key={field} variant="outline" className="font-mono font-normal">
                {field}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <ScrollText className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">
        {filtered ? 'No entries match these filters' : 'No audit entries yet'}
      </p>
      <p className="text-sm text-muted-foreground">
        {filtered
          ? 'Widen the date range or clear a filter.'
          : 'Entries appear here as soon as records are created, updated or deleted.'}
      </p>
    </div>
  );
}
