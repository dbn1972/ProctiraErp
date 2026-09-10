/**
 * DSAR export — Data Subject Access Request (G-913).
 *
 * Enter a subject id (student, staff, guardian or user id); the gateway
 * returns every audit entry where the subject is the affected entity or the
 * acting user. The page renders the package and offers a JSON download via the
 * authenticated proxy at `/api/audit-logs/dsar/[subjectId]`.
 */
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';

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
import { readParam, type SearchParams } from '@/components/platform/PlatformSurfaceState';
import { exportDsarPackage } from '@/lib/api/platform.server';
import { EmptyState } from '@/components/page';

export const dynamic = 'force-dynamic';

const INPUT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(d);
}

export default async function DsarPage(props: { searchParams?: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const subjectId = readParam(searchParams, 'subjectId')?.trim();
  const result = subjectId ? await exportDsarPackage(subjectId) : null;
  const pack = result?.data ?? null;

  return (
    <section aria-labelledby="dsar-heading" className="space-y-6" data-testid="dsar-page">
      <DocumentTitle pageTitle="DSAR export" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ms-2 mb-1">
            <Link href="/audit-logs">
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Audit logs
            </Link>
          </Button>
          <h1 id="dsar-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
            DSAR export
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Data Subject Access Request — everything the audit trail holds about one person, as the
            affected record or as the actor.
          </p>
        </div>
        {pack && subjectId ? (
          <Button asChild size="sm">
            <a
              href={`/api/audit-logs/dsar/${encodeURIComponent(subjectId)}`}
              download={`dsar-${subjectId}.json`}
              data-testid="dsar-download"
            >
              <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
              Download JSON
            </a>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="pt-6">
          <form
            method="get"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            aria-label="DSAR lookup"
          >
            <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground">
              Subject id
              <input
                name="subjectId"
                required
                defaultValue={subjectId ?? ''}
                placeholder="Student / staff / user id"
                className={INPUT_CLASS}
                data-testid="dsar-subject"
              />
            </label>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
              data-testid="dsar-run"
            >
              Build package
            </button>
          </form>
        </CardContent>
      </Card>

      {result?.access === 'forbidden' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          Platform administrator access is required to export DSAR packages.
        </p>
      ) : null}
      {result && result.access === 'ok' && result.source === 'scaffold' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          The gateway is not reachable from this environment.
        </p>
      ) : null}

      {pack ? (
        <Card className="overflow-hidden" data-testid="dsar-package">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Package for <span className="font-mono text-sm">{pack.subjectId}</span>
              <Badge variant="secondary">{pack.entryCount.toLocaleString()} entries</Badge>
              {pack.truncated ? <Badge variant="destructive">truncated</Badge> : null}
            </CardTitle>
            <CardDescription>
              Exported {formatTimestamp(pack.exportedAt)} UTC · tenant{' '}
              <span className="font-mono text-xs">{pack.tenantId}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {pack.entries.length === 0 ? (
              <EmptyState
                title="No audit entries for this subject"
                description="Nothing in the trail references this id as an entity or an actor."
              />
            ) : (
              <Table aria-label="DSAR entries">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="ps-4 font-semibold">When (UTC)</TableHead>
                    <TableHead className="font-semibold">Operation</TableHead>
                    <TableHead className="font-semibold">Entity</TableHead>
                    <TableHead className="font-semibold">Actor</TableHead>
                    <TableHead className="pe-4 font-semibold">Changed fields</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pack.entries.map((entry) => (
                    <TableRow key={entry.id} data-testid="dsar-row">
                      <TableCell className="ps-4 whitespace-nowrap tabular-nums">
                        <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.operation}</Badge>
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold text-foreground">{entry.entityType}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {entry.entityId}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-foreground">{entry.userName}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {entry.userId}
                        </p>
                      </TableCell>
                      <TableCell className="pe-4">
                        {entry.changedFields.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex max-w-md flex-wrap gap-1">
                            {entry.changedFields.map((field) => (
                              <Badge
                                key={field}
                                variant="outline"
                                className="font-mono font-normal"
                              >
                                {field}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
