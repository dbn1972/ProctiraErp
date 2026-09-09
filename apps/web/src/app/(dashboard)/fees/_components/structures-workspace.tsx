'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import { bulkInvoiceAction, createFeeStructureAction } from '@/lib/fees/actions';
import type { FeeStructure } from '@/lib/api/fees';

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function StructuresWorkspace({ structures }: { structures: FeeStructure[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ created: number; skipped: number } | null>(null);
  const [pending, startTransition] = useTransition();

  function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      const result = await createFeeStructureAction({
        name: String(fd.get('name') ?? ''),
        code: String(fd.get('code') ?? ''),
        category: String(fd.get('category') ?? ''),
        term: String(fd.get('term') ?? ''),
        amount: Number(fd.get('amount') ?? 0),
        classId: String(fd.get('classId') ?? ''),
        gradeId: String(fd.get('gradeId') ?? ''),
        partCount: Number(fd.get('partCount') ?? 1),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  function onBulk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setBulkError(null);
      setBulkResult(null);
      const result = await bulkInvoiceAction({
        structureId: String(fd.get('structureId') ?? ''),
        classId: String(fd.get('classId') ?? ''),
        studentIds: String(fd.get('studentIds') ?? ''),
        dueAt: String(fd.get('dueAt') ?? ''),
      });
      if (!result.success) {
        setBulkError(result.error);
        return;
      }
      setBulkResult(result.data ?? { created: 0, skipped: 0 });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fee structures</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Class × category × term amounts, instalment schedules, and bulk invoicing.
          </p>
        </div>
        <Button
          type="button"
          data-testid="new-structure"
          data-hydrated={hydrated ? 'true' : 'false'}
          disabled={!hydrated}
          onClick={() => setOpen(true)}
        >
          New structure
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            onSubmit={onCreate}
            data-testid="structure-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <DialogHeader>
              <DialogTitle>Create fee structure</DialogTitle>
              <DialogDescription>
                Amount is split across instalments so the parts always sum to the structure total.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-3 sm:grid-cols-2">
              <FormField id="st-name" label="Name" required>
                <Input id="st-name" name="name" required />
              </FormField>
              <FormField id="st-code" label="Code">
                <Input id="st-code" name="code" />
              </FormField>
              <FormField id="st-category" label="Category" required>
                <Input id="st-category" name="category" defaultValue="tuition" required />
              </FormField>
              <FormField id="st-term" label="Term">
                <Input id="st-term" name="term" />
              </FormField>
              <FormField id="st-amount" label="Amount (INR)" required>
                <Input id="st-amount" name="amount" type="number" min="0" step="0.01" required />
              </FormField>
              <FormField id="st-parts" label="Instalments">
                <Input
                  id="st-parts"
                  name="partCount"
                  type="number"
                  min="1"
                  max="24"
                  defaultValue="1"
                />
              </FormField>
              <FormField id="st-class" label="Class UUID">
                <Input id="st-class" name="classId" />
              </FormField>
              <FormField id="st-grade" label="Grade UUID">
                <Input id="st-grade" name="gradeId" />
              </FormField>
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={!hydrated || pending} data-testid="submit-structure">
                {pending ? 'Saving…' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bulk invoice a class</CardTitle>
          <CardDescription>
            Idempotent: students who already have an invoice for the structure are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onBulk}
            className="grid max-w-3xl gap-3 sm:grid-cols-2"
            data-testid="bulk-invoice-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <FormField id="bi-structure" label="Structure" required>
              <select
                id="bi-structure"
                name="structureId"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                defaultValue={structures[0]?.id ?? ''}
                disabled={!hydrated || pending}
              >
                {structures.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code} — {row.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="bi-class" label="Class UUID">
              <Input id="bi-class" name="classId" disabled={!hydrated || pending} />
            </FormField>
            <FormField id="bi-students" label="Student UUIDs (comma-separated)">
              <Input id="bi-students" name="studentIds" disabled={!hydrated || pending} />
            </FormField>
            <FormField id="bi-due" label="Due date">
              <Input id="bi-due" name="dueAt" type="date" disabled={!hydrated || pending} />
            </FormField>
            {bulkError ? (
              <p className="text-sm text-destructive sm:col-span-2" role="alert">
                {bulkError}
              </p>
            ) : null}
            {bulkResult ? (
              <p
                className="text-sm text-muted-foreground sm:col-span-2"
                role="status"
                data-testid="bulk-invoice-result"
                data-created={bulkResult.created}
                data-skipped={bulkResult.skipped}
              >
                {bulkResult.created} invoice(s) created
                {bulkResult.skipped > 0 ? `, ${bulkResult.skipped} skipped (already invoiced)` : ''}
                .
              </p>
            ) : null}
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={!hydrated || pending || structures.length === 0}
                data-testid="submit-bulk-invoice"
              >
                {pending ? 'Invoicing…' : 'Bulk invoice'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Structures</CardTitle>
          <CardDescription>
            {structures.length === 0 ? 'No structures yet.' : `${structures.length} structure(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {structures.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              role="status"
              data-testid="structures-empty"
            >
              Create a structure to bulk-invoice a class or grade.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {structures.map((row) => (
                <li
                  key={row.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="fee-structure-row"
                  data-structure-code={row.code}
                >
                  <p className="text-sm font-medium text-foreground">
                    {row.name}{' '}
                    <span className="font-normal text-muted-foreground">({row.code})</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAmount(row.amountCents, row.currency)} · {row.category}
                    {row.term ? ` · ${row.term}` : ''}
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
