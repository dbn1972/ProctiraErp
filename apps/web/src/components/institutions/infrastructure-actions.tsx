'use client';

/**
 * Infrastructure toolbar — Verification report + Log repair request.
 *
 * POST /institutions/:id/infrastructure/:itemId/repairs, then refresh history.
 */
import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Plus } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@proctira/ui/components';
import {
  createRepair,
  listRepairsForInstitution,
  type InfrastructureRepair,
} from '@/lib/api/repairs';

interface InfrastructureActionsProps {
  institutionId: string;
  /** Flattened facility nodes for target select + history aggregation. */
  facilityOptions?: Array<{ id: string; label: string }>;
}

const CONDITION_OPTIONS = [
  'GOOD',
  'FAIR',
  'NEEDS_REPAIR',
  'POOR',
  'UNAVAILABLE',
];

export function InfrastructureActions({
  institutionId,
  facilityOptions = [],
}: InfrastructureActionsProps) {
  const router = useRouter();
  const [repairs, setRepairs] = useState<InfrastructureRepair[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [logOpen, setLogOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [conditionAfter, setConditionAfter] = useState('GOOD');
  const [infrastructureId, setInfrastructureId] = useState('');
  const [cost, setCost] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const facilityKey = facilityOptions.map((f) => f.id).join(',');

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const rows = await listRepairsForInstitution(institutionId, facilityOptions);
      setRepairs(rows);
    } catch (err) {
      setRepairs([]);
      setLoadError(err instanceof Error ? err.message : 'Could not load repair history');
    } finally {
      setLoading(false);
    }
    // facilityOptions identity changes every render; key on ids instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- facilityKey tracks option ids
  }, [institutionId, facilityKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openLog() {
    setNotes('');
    setDate(new Date().toISOString().slice(0, 10));
    setConditionAfter('GOOD');
    setInfrastructureId(facilityOptions[0]?.id ?? '');
    setCost('');
    setFormError(null);
    setLogOpen(true);
  }

  function submitRepair(event: React.FormEvent) {
    event.preventDefault();
    const trimmedNotes = notes.trim();
    if (!infrastructureId) {
      setFormError('Select a facility to attach this repair to');
      return;
    }
    if (!trimmedNotes) {
      setFormError('Notes are required');
      return;
    }
    if (!conditionAfter.trim()) {
      setFormError('Condition after repair is required');
      return;
    }
    setFormError(null);
    const parsedCost = cost.trim() === '' ? undefined : Number(cost);
    if (parsedCost !== undefined && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
      setFormError('Cost must be a non-negative number');
      return;
    }

    startTransition(async () => {
      try {
        await createRepair(institutionId, infrastructureId, {
          date,
          notes: trimmedNotes,
          conditionAfter: conditionAfter.trim(),
          cost: parsedCost,
        });
        setLogOpen(false);
        setLoading(true);
        await refresh();
        router.refresh();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to log repair');
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => setReportOpen(true)}
        >
          <FileText className="me-1.5 h-4 w-4" aria-hidden="true" />
          Verification report
        </Button>
        <Button
          size="sm"
          type="button"
          onClick={openLog}
          disabled={facilityOptions.length === 0}
          title={
            facilityOptions.length === 0
              ? 'Add facilities before logging a repair'
              : undefined
          }
        >
          <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
          Log repair request
        </Button>
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="text-base font-semibold text-foreground">Repair history</h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Logged repairs across this institution&apos;s facilities, newest first.
          </p>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : loadError ? (
            <p className="py-6 text-center text-sm text-destructive" role="alert">
              {loadError}
            </p>
          ) : repairs.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No repair requests logged yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {repairs.map((repair) => (
                <li
                  key={repair.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {repair.facilityLabel ?? 'Facility'} · {repair.conditionAfter}
                    </p>
                    <p className="text-sm text-muted-foreground">{repair.notes}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {repair.repairDate}
                      {repair.cost != null
                        ? ` · cost ${repair.cost.toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
                    Logged
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log repair request</DialogTitle>
            <DialogDescription>
              Record work against a facility and update its condition after repair.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitRepair} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="repair-facility">Facility</Label>
              <select
                id="repair-facility"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={infrastructureId}
                onChange={(e) => setInfrastructureId(e.target.value)}
                required
              >
                <option value="">— Select facility —</option>
                {facilityOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repair-date">Repair date</Label>
              <Input
                id="repair-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repair-notes">Notes</Label>
              <Textarea
                id="repair-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Roof leakage sealed; tarpaulin removed…"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repair-condition">Condition after</Label>
              <select
                id="repair-condition"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={conditionAfter}
                onChange={(e) => setConditionAfter(e.target.value)}
              >
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repair-cost">Cost (optional)</Label>
              <Input
                id="repair-cost"
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0"
              />
            </div>
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLogOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !notes.trim() || !infrastructureId}>
                {isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Submit request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verification report</DialogTitle>
            <DialogDescription>
              Snapshot of repair logs for physical verification.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {repairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No repair history on file. Log a request or complete a site verification.
              </p>
            ) : (
              repairs.map((repair) => (
                <div key={repair.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-semibold text-foreground">
                    {repair.facilityLabel ?? 'Facility'} · {repair.conditionAfter}
                  </p>
                  <p className="mt-1 text-muted-foreground">{repair.notes}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{repair.repairDate}</p>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReportOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                setReportOpen(false);
                openLog();
              }}
              disabled={facilityOptions.length === 0}
            >
              Log repair
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
