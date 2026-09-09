/**
 * Audit logs — tenant audit trail viewer (Server Component, G-727).
 *
 * Reads `GET /api/v1/audit-logs` (platform scope) with entity/user/operation
 * and date filters carried in the URL so views are shareable and the page is
 * fully server-rendered (no client fetch, works without JS).
 */
import Link from 'next/link';
import { FileSearch, ShieldAlert, ShieldCheck } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import {
  getAuditRetention,
  listAuditLogs,
  verifyAuditChain,
  type AuditChainVerification,
  type AuditLogEntry,
} from '@/lib/api/platform.server';
import { RetentionPolicyForm } from '@/components/audit/audit-integrity-panel';
import { EmptyState } from '@/components/page';

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

export default async function AuditLogsPage(props: { searchParams?: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const entityType = readParam(searchParams, 'entityType');
  const entityId = readParam(searchParams, 'entityId');
  const userId = readParam(searchParams, 'userId');
  const operation = readParam(searchParams, 'operation');
  const from = readParam(searchParams, 'from');
  const to = readParam(searchParams, 'to');
  const page = readPage(searchParams);

  const [result, chain, retention] = await Promise.all([
    listAuditLogs({
      entityType,
      entityId,
      userId,
      operation,
      startDate: toApiDate(from),
      endDate: toApiDate(to),
      page,
      pageSize: 25,
    }),
    verifyAuditChain(),
    getAuditRetention(),
  ]);
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
        <div className="flex flex-col items-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/audit-logs/dsar" data-testid="dsar-link">
              <FileSearch className="me-1.5 h-4 w-4" aria-hidden="true" />
              DSAR export
            </Link>
          </Button>
          {result.meta.totalItems > 0 ? (
            <p className="text-sm text-muted-foreground">
              {result.meta.totalItems.toLocaleString()} matching entr
              {result.meta.totalItems === 1 ? 'y' : 'ies'}
            </p>
          ) : null}
        </div>
      </div>

      <PlatformSurfaceState surface="Audit logs" result={result} />

      {result.access === 'ok' && result.source === 'gateway' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChainIntegrityCard verification={chain.data} />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Retention policy</CardTitle>
              <CardDescription>
                {retention.data
                  ? `Retain ${retention.data.retentionMonths} months · archival ${
                      retention.data.archivalEnabled ? 'on' : 'off'
                    }`
                  : 'No policy yet — entries are kept indefinitely until one is saved.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RetentionPolicyForm config={retention.data} />
            </CardContent>
          </Card>
        </div>
      ) : null}

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
            <EmptyState
              title={filtered ? 'No entries match these filters' : 'No audit entries yet'}
              description={
                filtered
                  ? 'Widen the date range or clear a filter.'
                  : 'Entries appear here as soon as records are created, updated or deleted.'
              }
            />
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

function ChainIntegrityCard({ verification }: { verification: AuditChainVerification | null }) {
  if (!verification) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Chain integrity</CardTitle>
          <CardDescription>Verification unavailable from the gateway.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const Icon = verification.valid ? ShieldCheck : ShieldAlert;
  return (
    <Card data-testid="chain-integrity" data-valid={verification.valid ? 'true' : 'false'}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon
            className={verification.valid ? 'h-5 w-5 text-emerald-600' : 'h-5 w-5 text-destructive'}
            aria-hidden="true"
          />
          Chain integrity
          <Badge variant={verification.valid ? 'success' : 'destructive'}>
            {verification.valid ? 'Verified' : 'BROKEN'}
          </Badge>
        </CardTitle>
        <CardDescription>
          Every entry is sha256-linked to the previous one; the chain is recomputed from the first
          entry on each load.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Entries verified</dt>
          <dd className="tabular-nums">{verification.checkedEntries.toLocaleString()}</dd>
          <dt className="text-muted-foreground">Legacy (pre-chain) entries</dt>
          <dd className="tabular-nums">{verification.legacyEntries.toLocaleString()}</dd>
          <dt className="text-muted-foreground">Head</dt>
          <dd className="truncate font-mono text-xs" title={verification.headHash ?? ''}>
            #{verification.headSeq}{' '}
            {verification.headHash ? verification.headHash.slice(0, 16) : '—'}
          </dd>
          <dt className="text-muted-foreground">Checked at (UTC)</dt>
          <dd className="tabular-nums">{formatTimestamp(verification.verifiedAt)}</dd>
        </dl>
        {verification.brokenAt ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
          >
            Break at position #{verification.brokenAt.chainSeq} (entry{' '}
            <span className="font-mono">{verification.brokenAt.entryId}</span>):{' '}
            {verification.brokenAt.reason}. Treat every later entry as unverified and escalate to
            the platform security owner.
          </p>
        ) : null}
      </CardContent>
    </Card>
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
