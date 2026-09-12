'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import {
  addReminderSuppressionAction,
  removeReminderSuppressionAction,
  sendFeeRemindersAction,
} from '@/lib/fees/actions';
import type {
  OverdueReminderRow,
  ReminderSendAudit,
  ReminderSuppression,
  SendRemindersResult,
} from '@/lib/api/fees';

function formatMoney(cents: number, currency = 'INR'): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export function DunningConsole({
  overdue,
  asOf,
  suppressions,
  audits,
  honestyNote,
}: {
  overdue: OverdueReminderRow[];
  asOf: string;
  suppressions: ReminderSuppression[];
  audits: ReminderSendAudit[];
  honestyNote: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [selected, setSelected] = useState<string[]>([]);
  const [channels, setChannels] = useState<{ email: boolean; sms: boolean }>({
    email: true,
    sms: false,
  });
  const [minOverdueDays, setMinOverdueDays] = useState('1');
  const [cadenceDays, setCadenceDays] = useState('7');
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<SendRemindersResult | null>(null);
  const [pending, startTransition] = useTransition();

  const selectable = useMemo(
    () => overdue.filter((row) => !row.suppressed).map((row) => row.invoiceId),
    [overdue],
  );

  function toggleInvoice(invoiceId: string) {
    setSelected((prev) =>
      prev.includes(invoiceId) ? prev.filter((id) => id !== invoiceId) : [...prev, invoiceId],
    );
  }

  function toggleAll() {
    setSelected((prev) => (prev.length === selectable.length ? [] : [...selectable]));
  }

  function onSend() {
    const activeChannels = (['email', 'sms'] as const).filter((c) => channels[c]);
    startTransition(async () => {
      setError(null);
      setSendResult(null);
      const result = await sendFeeRemindersAction({
        invoiceIds: selected,
        channels: [...activeChannels],
        minOverdueDays: Number(minOverdueDays) || 1,
        cadenceDays: Number(cadenceDays) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSendResult(result.data);
      setSelected([]);
      router.refresh();
    });
  }

  function onAddSuppression(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      const result = await addReminderSuppressionAction({
        studentId: String(fd.get('studentId') ?? '').trim(),
        invoiceId: String(fd.get('invoiceId') ?? '').trim(),
        reason: String(fd.get('reason') ?? '').trim(),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      event.currentTarget.reset();
      router.refresh();
    });
  }

  function onRemoveSuppression(id: string) {
    startTransition(async () => {
      setError(null);
      const result = await removeReminderSuppressionAction(id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className="space-y-6"
      data-testid="dunning-console"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
        role="status"
        data-testid="dunning-sandbox-banner"
      >
        {honestyNote} G-709 live Twilio/SES delivery is not claimed on this surface.
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert" data-testid="dunning-error">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overdue feed</CardTitle>
          <CardDescription>
            From <code className="text-xs">GET /fees/reminders/overdue</code> as of{' '}
            {new Date(asOf).toLocaleString()}. Suppressed rows cannot be selected for send.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {overdue.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="dunning-empty">
              No overdue open invoices for this tenant.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={toggleAll}
                  disabled={!hydrated || pending || selectable.length === 0}
                  data-testid="dunning-select-all"
                >
                  {selected.length === selectable.length && selectable.length > 0
                    ? 'Clear selection'
                    : 'Select all sendable'}
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={channels.email}
                    onChange={(e) => setChannels((c) => ({ ...c, email: e.target.checked }))}
                    disabled={!hydrated || pending}
                  />
                  Email
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={channels.sms}
                    onChange={(e) => setChannels((c) => ({ ...c, sms: e.target.checked }))}
                    disabled={!hydrated || pending}
                  />
                  SMS
                </label>
                <FormField id="min-overdue" label="Min overdue days">
                  <Input
                    id="min-overdue"
                    type="number"
                    min={1}
                    value={minOverdueDays}
                    onChange={(e) => setMinOverdueDays(e.target.value)}
                    disabled={!hydrated || pending}
                    className="w-24"
                  />
                </FormField>
                <FormField id="cadence-days" label="Cadence days">
                  <Input
                    id="cadence-days"
                    type="number"
                    min={0}
                    value={cadenceDays}
                    onChange={(e) => setCadenceDays(e.target.value)}
                    disabled={!hydrated || pending}
                    className="w-24"
                  />
                </FormField>
                <Button
                  type="button"
                  onClick={onSend}
                  disabled={
                    !hydrated ||
                    pending ||
                    selected.length === 0 ||
                    (!channels.email && !channels.sms)
                  }
                  data-testid="dunning-send"
                >
                  {pending ? 'Sending…' : `Send sandbox reminders (${selected.length})`}
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="dunning-overdue-table">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-2 font-medium">Select</th>
                      <th className="py-2 pr-2 font-medium">Invoice</th>
                      <th className="py-2 pr-2 font-medium">Student</th>
                      <th className="py-2 pr-2 font-medium">Amount</th>
                      <th className="py-2 pr-2 font-medium">Overdue</th>
                      <th className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.map((row) => (
                      <tr key={row.invoiceId} className="border-b border-border/60">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            aria-label={`Select invoice ${row.invoiceNumber ?? row.invoiceId}`}
                            checked={selected.includes(row.invoiceId)}
                            disabled={!hydrated || pending || row.suppressed}
                            onChange={() => toggleInvoice(row.invoiceId)}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <code className="text-xs">{row.invoiceNumber ?? row.invoiceId}</code>
                        </td>
                        <td className="py-2 pr-2">
                          <code className="text-xs">{row.studentId}</code>
                        </td>
                        <td className="py-2 pr-2">{formatMoney(row.amountCents, row.currency)}</td>
                        <td className="py-2 pr-2">{row.overdueDays}d</td>
                        <td className="py-2">
                          {row.suppressed ? (
                            <span className="text-muted-foreground">Suppressed</span>
                          ) : (
                            <span>Sendable</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {sendResult ? (
        <Card data-testid="dunning-send-result">
          <CardHeader>
            <CardTitle className="text-base">Send result</CardTitle>
            <CardDescription>
              Mode: {sendResult.mode}. {sendResult.honestyNote}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {sendResult.results.map((row, index) => (
                <li key={`${row.invoiceId}-${row.channel}-${index}`}>
                  <code className="text-xs">{row.invoiceId.slice(0, 8)}</code> · {row.channel}
                  {row.messageId
                    ? ` · ${row.messageId}`
                    : ` · skipped (${row.skippedReason ?? 'unknown'})`}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Suppressions</CardTitle>
            <CardDescription>
              Student- or invoice-level blocks so collections does not blast families.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              onSubmit={onAddSuppression}
              className="space-y-3"
              aria-busy={pending}
              data-testid="dunning-suppression-form"
            >
              <FormField id="sup-student" label="Student UUID">
                <Input id="sup-student" name="studentId" disabled={!hydrated || pending} />
              </FormField>
              <FormField id="sup-invoice" label="Invoice UUID">
                <Input id="sup-invoice" name="invoiceId" disabled={!hydrated || pending} />
              </FormField>
              <FormField id="sup-reason" label="Reason" required>
                <Input id="sup-reason" name="reason" required disabled={!hydrated || pending} />
              </FormField>
              <Button
                type="submit"
                disabled={!hydrated || pending}
                data-testid="dunning-add-suppression"
              >
                Add suppression
              </Button>
            </form>
            {suppressions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suppressions yet.</p>
            ) : (
              <ul className="space-y-2 text-sm" data-testid="dunning-suppression-list">
                {suppressions.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 py-2"
                  >
                    <div>
                      <p>{row.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.studentId ? `student ${row.studentId}` : null}
                        {row.studentId && row.invoiceId ? ' · ' : null}
                        {row.invoiceId ? `invoice ${row.invoiceId}` : null}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!hydrated || pending}
                      onClick={() => onRemoveSuppression(row.id)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send audit</CardTitle>
            <CardDescription>
              Sandbox message IDs only — proof of operator send, not carrier delivery.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {audits.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="dunning-audit-empty">
                No reminder sends recorded yet.
              </p>
            ) : (
              <ul className="space-y-2 text-sm" data-testid="dunning-audit-list">
                {audits.slice(0, 20).map((row) => (
                  <li key={row.id} className="border-b border-border/60 py-2">
                    <p>
                      {row.channel} · <code className="text-xs">{row.messageId}</code>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()} · invoice{' '}
                      <code className="text-xs">{row.invoiceId}</code>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
