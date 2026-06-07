/**
 * AuditDetailPage — Before/after diff view for a single audit entry (Task 60A.10).
 *
 * Shows the full detail of an audit entry including:
 *   - Entry metadata (timestamp, user, entity, operation, IP)
 *   - Before/after values for each changed field in a side-by-side diff layout
 *
 * Navigated to from the AuditViewer list via `/app/settings/audit/:entryId`.
 *
 * Validates: Requirements 21.1, 21.2, 21.3, 21.4 (Requirement 33.4 — high-risk diff)
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';

import { type AuditEntry, type AuditFieldChange, getAuditEntry } from '@/lib/api/audit';

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function operationLabel(op: string): string {
  switch (op) {
    case 'CREATE':
      return 'Created';
    case 'UPDATE':
      return 'Updated';
    case 'DELETE':
      return 'Deleted';
    default:
      return op;
  }
}

function operationBadgeVariant(
  op: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (op) {
    case 'CREATE':
      return 'default';
    case 'UPDATE':
      return 'secondary';
    case 'DELETE':
      return 'destructive';
    default:
      return 'outline';
  }
}

// ─── Component ───────────────────────────────────────────────────────────

export default function AuditDetailPage(): JSX.Element {
  const { entryId } = useParams<{ entryId: string }>();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<AuditEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    getAuditEntry(entryId)
      .then((data) => {
        if (!cancelled) {
          setEntry(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load audit entry');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [entryId]);

  // ─── Loading ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 p-6" role="status" aria-label="Loading audit entry">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="p-6 space-y-4">
        <Alert variant="destructive" data-testid="detail-error">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate(-1)}>
          ← Back to audit trail
        </Button>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="p-6 space-y-4">
        <Alert data-testid="not-found">
          <AlertDescription>Audit entry not found.</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate(-1)}>
          ← Back to audit trail
        </Button>
      </div>
    );
  }

  // ─── Detail view ───────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      {/* Back navigation */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(-1)}
        data-testid="back-button"
      >
        ← Back to audit trail
      </Button>

      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Audit Entry Detail</h1>
          <Badge variant={operationBadgeVariant(entry.operation)}>
            {operationLabel(entry.operation)}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Entry ID: <code className="font-mono">{entry.id}</code>
        </p>
      </header>

      {/* Metadata card */}
      <Card data-testid="entry-metadata">
        <CardContent className="p-4">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Timestamp</dt>
              <dd>
                <time dateTime={entry.timestamp}>
                  {new Date(entry.timestamp).toLocaleString()}
                </time>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">User</dt>
              <dd>{entry.userDisplayName}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Entity Type</dt>
              <dd className="font-mono text-sm">{entry.entityType}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Entity ID</dt>
              <dd className="font-mono text-sm">{entry.entityId}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Operation</dt>
              <dd>{operationLabel(entry.operation)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">IP Address</dt>
              <dd className="font-mono text-sm">{entry.ipAddress ?? '—'}</dd>
            </div>
          </dl>
          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div className="mt-4 border-t pt-4">
              <dt className="text-sm font-medium text-muted-foreground mb-2">Metadata</dt>
              <dd>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              </dd>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Changes diff table */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Changes</h2>
        {entry.changes.length === 0 ? (
          <Alert>
            <AlertDescription>No field-level changes recorded for this entry.</AlertDescription>
          </Alert>
        ) : (
          <div className="border rounded overflow-x-auto">
            <Table data-testid="changes-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/4">Field</TableHead>
                  <TableHead className="w-[37.5%]">Before</TableHead>
                  <TableHead className="w-[37.5%]">After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.changes.map((change: AuditFieldChange) => (
                  <TableRow key={change.field} data-testid={`change-row-${change.field}`}>
                    <TableCell className="font-mono text-sm font-medium">
                      {change.field}
                    </TableCell>
                    <TableCell>
                      <DiffValue value={change.before} variant="before" />
                    </TableCell>
                    <TableCell>
                      <DiffValue value={change.after} variant="after" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function DiffValue({
  value,
  variant,
}: {
  value: unknown;
  variant: 'before' | 'after';
}): JSX.Element {
  const formatted = formatValue(value);
  const isNull = value === null || value === undefined;
  const isMultiline = formatted.includes('\n');

  if (isNull) {
    return <span className="text-muted-foreground italic">—</span>;
  }

  const bgClass = variant === 'before' ? 'bg-red-50 dark:bg-red-950/20' : 'bg-green-50 dark:bg-green-950/20';
  const borderClass = variant === 'before' ? 'border-red-200 dark:border-red-800' : 'border-green-200 dark:border-green-800';

  if (isMultiline) {
    return (
      <pre
        className={`text-xs p-2 rounded border overflow-x-auto ${bgClass} ${borderClass}`}
      >
        {formatted}
      </pre>
    );
  }

  return (
    <span className={`text-sm px-1.5 py-0.5 rounded border ${bgClass} ${borderClass}`}>
      {formatted}
    </span>
  );
}
