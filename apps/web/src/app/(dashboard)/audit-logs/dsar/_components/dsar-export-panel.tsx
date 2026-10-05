'use client';
/**
 * DSAR lookup + package view (PRC-M084).
 *
 * The export only runs when the user presses "Build package"; refreshing or
 * opening a `?subjectId=` link just pre-fills the field. Each export is
 * audited by the gateway. "Download JSON" saves the package that was already
 * exported (no second export).
 */
import { useState, useTransition } from 'react';
import { Download } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { EmptyState } from '@/components/page';
import { useHydrated } from '@/hooks/useHydrated';
import { resolveEntityLabel, type EntityLabelOption } from '@/lib/entity-label';

import { buildDsarPackageAction, type DsarExportResult } from '../actions';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(d);
}

function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the browser has started the download (sync revoke can cancel it).
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function DsarExportPanel({
  subjectOptions,
  defaultSubjectId = '',
}: {
  subjectOptions: EntityLabelOption[];
  defaultSubjectId?: string;
}) {
  const [subjectId, setSubjectId] = useState(defaultSubjectId);
  const [result, setResult] = useState<DsarExportResult | null>(null);
  const [pending, startTransition] = useTransition();
  // Before hydration the form has no submit handler and would fall back to a
  // native GET (which only pre-fills the field), so keep "Build package"
  // disabled until React is attached.
  const hydrated = useHydrated();
  const pack = result?.status === 'ok' ? result.pack : null;
  const labels = result?.labels ?? {};

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            aria-label="DSAR lookup"
            data-testid="dsar-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            onSubmit={(event) => {
              event.preventDefault();
              if (pending) return;
              startTransition(async () => {
                setResult(await buildDsarPackageAction(subjectId));
              });
            }}
          >
            <div className="flex-1 space-y-1.5" data-testid="dsar-subject">
              <Label htmlFor="dsar-subject-id">Subject</Label>
              {/*
               * Free-text input with directory suggestions: the gateway resolves
               * any audit subject (system users, service accounts, other entity
               * ids), not only students/staff, so the directory is a convenience.
               */}
              <Input
                id="dsar-subject-id"
                name="subjectId"
                required
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                placeholder="Student / staff / user id"
                list={subjectOptions.length > 0 ? 'dsar-subject-options' : undefined}
                data-testid="dsar-subject-input"
              />
              {subjectOptions.length > 0 ? (
                <datalist id="dsar-subject-options">
                  {subjectOptions.map((option) => (
                    <option key={option.id} value={option.id} label={option.label} />
                  ))}
                </datalist>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={pending || !hydrated}
              className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              data-testid="dsar-run"
            >
              {pending ? 'Building…' : 'Build package'}
            </button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Each package build is recorded in the audit trail with your account and the subject.
          </p>
        </CardContent>
      </Card>

      {result?.status === 'forbidden' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          Platform administrator access is required to export DSAR packages.
        </p>
      ) : null}
      {result?.status === 'unavailable' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          The gateway is not reachable from this environment.
        </p>
      ) : null}
      {result?.status === 'invalid' || result?.status === 'error' ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {result.message}
        </p>
      ) : null}

      {pack ? (
        <Card className="overflow-hidden" data-testid="dsar-package">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  Package for {resolveEntityLabel(pack.subjectId, labels, 'Subject')}
                  <Badge variant="secondary">{pack.entryCount.toLocaleString()} entries</Badge>
                  {pack.truncated ? <Badge variant="destructive">truncated</Badge> : null}
                </CardTitle>
                <CardDescription>
                  Exported {formatTimestamp(pack.exportedAt)} UTC · tenant{' '}
                  <span className="font-mono text-xs">{pack.tenantId}</span>
                </CardDescription>
              </div>
              {result?.downloadJson ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    downloadJson(`dsar-${pack.subjectId}.json`, result.downloadJson ?? '')
                  }
                  data-testid="dsar-download"
                >
                  <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
                  Download JSON
                </Button>
              ) : null}
            </div>
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
                        <p className="text-[11px] text-muted-foreground">
                          {resolveEntityLabel(entry.entityId, labels, entry.entityType || 'Record')}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-foreground">{entry.userName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {resolveEntityLabel(entry.userId, labels, 'User')}
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
    </div>
  );
}
