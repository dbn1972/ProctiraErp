'use client';

/**
 * <ConflictResolutionDialog> — 409 conflict surface for the Sync_Queue.
 * Task 54.5 / Requirement 38.7 / Design §I.
 * =====================================================================
 *
 * When a queued write replays and the API_Gateway returns `409 Conflict`,
 * the gateway includes the structured envelope documented in
 * `apps/web/src/lib/sync/conflict.ts` (`ConflictPayload`). The
 * `ConnectivityProvider` parses that envelope and fires a
 * `sync:conflict` window event; this dialog listens for the event and
 * presents the user with:
 *
 *   • The local payload (parsed from the queued JSON body).
 *   • The server payload (the authoritative `server_record`).
 *   • A side-by-side diff with each conflicting field highlighted.
 *     Each field shows server value vs local value with a per-field
 *     "Use server" / "Use my value" radio so the user controls the
 *     merge.
 *   • Two terminal actions:
 *       - **Amend**: emits `sync:amend-conflict` so the originating
 *         wizard / form re-opens with the merged payload pre-filled.
 *         The queued op is removed; the form is responsible for
 *         re-enqueuing the new attempt with the resolution token.
 *       - **Discard**: emits `sync:discard-conflict` so optimistic
 *         stores can reconcile their local state to `server_record`,
 *         then dequeues the operation.
 *
 * Single instance. Mount once at the app root (e.g. `<AppShell>`); it
 * subscribes to `window` events and queues incoming conflicts so a
 * burst of 409s during a long replay does not lose any.
 *
 * SSR safety. The component renders nothing on the server (effects
 * subscribe to `window` only on the client) and the dialog primitives
 * portal to `document.body`, which means the markup is empty until a
 * conflict arrives.
 *
 * Accessibility. Uses the shared `<Dialog>` primitive (Radix), which
 * traps focus and exposes the standard role/aria semantics. The two
 * action buttons inherit the 48 × 48 touch-target floor from
 * `@proctira/ui-components/Button`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@proctira/ui/components';
import { dequeue } from '@/lib/sync/syncQueue';
import {
  SYNC_AMEND_CONFLICT_EVENT,
  SYNC_CONFLICT_EVENT,
  SYNC_DISCARD_CONFLICT_EVENT,
  mergeResolutions,
  type ConflictResolution,
  type FieldConflict,
  type SyncAmendConflictEventDetail,
  type SyncConflictEventDetail,
  type SyncDiscardConflictEventDetail,
} from '@/lib/sync/conflict';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Produce a stable, human-readable rendering of a JSON value for the
 * side-by-side panels. Non-string scalars get their JSON form (so
 * numbers and booleans are unambiguous); strings render as-is so the
 * user does not see surrounding quotes.
 */
function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Same as `formatValue` but for the entire payload panels — always
 * pretty-prints objects/arrays for readability. */
function formatPayload(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Internal queue type — we hold the most recent conflict in state and
 * keep a small buffer of pending ones so a 409-burst is processed in
 * arrival order. The buffer is bounded; an extreme burst is trimmed
 * to the most recent N entries (older conflicts are rare in practice
 * because the user must act on the previous one before a new one can
 * be displayed).
 */
const MAX_PENDING_CONFLICTS = 10;

export interface ConflictResolutionDialogProps {
  /**
   * Optional override for the `dequeue` helper. Tests inject a spy
   * to verify the Discard action removes the op from the queue
   * without needing a real IndexedDB.
   */
  dequeueOperation?: (id: string) => Promise<void>;
}

export function ConflictResolutionDialog({
  dequeueOperation = dequeue,
}: ConflictResolutionDialogProps = {}) {
  const t = useTranslations('sync.conflict');

  // Queue of incoming conflicts. The head (`pending[0]`) is the one
  // currently rendered; subsequent entries wait their turn.
  const [pending, setPending] = useState<SyncConflictEventDetail[]>([]);
  // Per-field resolution choices for the active conflict. Defaults to
  // `'client'` (user keeps their value) per field; users flip to
  // `'server'` to accept the authoritative value.
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});

  const active = pending[0] ?? null;

  // Subscribe to incoming conflicts. The handler is a stable identity
  // so we attach exactly once even when the parent re-renders.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: WindowEventMap[typeof SYNC_CONFLICT_EVENT]) => {
      const detail = event.detail;
      setPending((prev) => {
        // Drop duplicates (same queueId arriving twice if the user
        // triggers a manual replay during another drain).
        if (prev.some((p) => p.queueId === detail.queueId)) return prev;
        const next = [...prev, detail];
        // Bound the queue so a pathological burst can't grow unboundedly.
        return next.slice(-MAX_PENDING_CONFLICTS);
      });
    };
    window.addEventListener(SYNC_CONFLICT_EVENT, handler);
    return () => {
      window.removeEventListener(SYNC_CONFLICT_EVENT, handler);
    };
  }, []);

  // Reset the resolution map whenever a new active conflict arrives.
  // We seed each conflicting field with `'client'` (keep my value) so
  // an Amend without changes resubmits the same payload — the gateway
  // can then decide whether the new resolution token clears it.
  useEffect(() => {
    if (!active) {
      setResolutions({});
      return;
    }
    const seed: Record<string, ConflictResolution> = {};
    for (const conflict of active.conflict.field_conflicts) {
      seed[conflict.field] = 'client';
    }
    setResolutions(seed);
  }, [active]);

  // Dismiss the head of the queue and advance to the next conflict.
  const advance = useCallback(() => {
    setPending((prev) => prev.slice(1));
  }, []);

  // ─── Action handlers ────────────────────────────────────────────────────

  const handleAmend = useCallback(async () => {
    if (!active) return;
    const merged = mergeResolutions(
      active.localPayload,
      active.conflict.field_conflicts,
      resolutions,
    );
    const detail: SyncAmendConflictEventDetail = {
      queueId: active.queueId,
      method: active.method,
      url: active.url,
      targetEntity: active.targetEntity,
      targetId: active.targetId,
      mergedPayload: merged,
      resolutionToken: active.conflict.resolution_token,
    };
    // Drop the failed queue entry. The form/wizard listening for
    // `sync:amend-conflict` is responsible for re-opening with the
    // merged values and re-enqueuing the new attempt (with the
    // resolution token attached so the gateway can correlate).
    await dequeueOperation(active.queueId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(SYNC_AMEND_CONFLICT_EVENT, { detail }),
      );
    }
    advance();
  }, [active, advance, dequeueOperation, resolutions]);

  const handleDiscard = useCallback(async () => {
    if (!active) return;
    const detail: SyncDiscardConflictEventDetail = {
      queueId: active.queueId,
      targetEntity: active.targetEntity,
      targetId: active.targetId,
      serverRecord: active.conflict.server_record,
    };
    // Reconcile listeners can update their optimistic state to the
    // authoritative server record. Then drop the queued op — the
    // user has explicitly chosen to abandon the local change.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(SYNC_DISCARD_CONFLICT_EVENT, { detail }),
      );
    }
    await dequeueOperation(active.queueId);
    advance();
  }, [active, advance, dequeueOperation]);

  // ─── Field-level resolution toggling ────────────────────────────────────

  const setResolution = useCallback(
    (field: string, choice: ConflictResolution) => {
      setResolutions((prev) => ({ ...prev, [field]: choice }));
    },
    [],
  );

  // Build the payload panels once per active conflict.
  const localPanel = useMemo(
    () => formatPayload(active?.localPayload),
    [active],
  );
  const serverPanel = useMemo(
    () => formatPayload(active?.conflict.server_record),
    [active],
  );

  if (!active) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Prevent dismissal via the X / overlay — the user must
        // explicitly choose Amend or Discard so the queued op is
        // never silently abandoned.
        if (!open) return;
      }}
    >
      <DialogContent
        data-testid="conflict-resolution-dialog"
        className="max-w-3xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description', {
              entity: active.targetEntity,
              method: active.method,
            })}
          </DialogDescription>
        </DialogHeader>

        {/* ─── Conflicting fields diff ────────────────────────────────── */}
        <section
          aria-labelledby="conflict-fields-heading"
          data-testid="conflict-fields"
          className="space-y-4"
        >
          <h3
            id="conflict-fields-heading"
            className="text-sm font-semibold text-foreground"
          >
            {t('fieldsHeading', { count: active.conflict.field_conflicts.length })}
          </h3>
          <ul className="space-y-3">
            {active.conflict.field_conflicts.map((conflict) => (
              <FieldConflictRow
                key={conflict.field}
                conflict={conflict}
                resolution={resolutions[conflict.field] ?? 'client'}
                onChange={(choice) => setResolution(conflict.field, choice)}
                t={t}
              />
            ))}
          </ul>
        </section>

        {/* ─── Full payload comparison (collapsed by default) ─────────── */}
        <details className="mt-2" data-testid="conflict-payloads">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {t('payloadsToggle')}
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <PayloadPanel
              label={t('localPayload')}
              testId="conflict-local-payload"
              content={localPanel}
            />
            <PayloadPanel
              label={t('serverPayload')}
              testId="conflict-server-payload"
              content={serverPanel}
            />
          </div>
        </details>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-testid="conflict-discard"
            onClick={() => {
              void handleDiscard();
            }}
          >
            {t('discard')}
          </Button>
          <Button
            type="button"
            data-testid="conflict-amend"
            onClick={() => {
              void handleAmend();
            }}
          >
            {t('amend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface FieldConflictRowProps {
  conflict: FieldConflict;
  resolution: ConflictResolution;
  onChange: (choice: ConflictResolution) => void;
  t: ReturnType<typeof useTranslations>;
}

function FieldConflictRow({ conflict, resolution, onChange, t }: FieldConflictRowProps) {
  const groupName = `conflict-resolution-${conflict.field}`;
  return (
    <li
      data-testid={`conflict-field-${conflict.field}`}
      className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <code className="text-sm font-semibold text-foreground">{conflict.field}</code>
        <span className="text-xs text-muted-foreground">
          {t('serverVersion', { version: conflict.server_version })}
        </span>
      </div>
      <fieldset
        className="mt-3 grid gap-3 sm:grid-cols-2"
        aria-label={t('fieldsetLabel', { field: conflict.field })}
      >
        <label className="flex cursor-pointer flex-col gap-1 rounded-md border border-[hsl(var(--border))] bg-background p-3">
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name={groupName}
              value="client"
              checked={resolution === 'client'}
              onChange={() => onChange('client')}
              data-testid={`conflict-${conflict.field}-keep-client`}
            />
            <span className="text-xs font-medium text-foreground">
              {t('keepLocal')}
            </span>
          </span>
          <span
            className="break-words text-sm text-foreground"
            data-testid={`conflict-${conflict.field}-client-value`}
          >
            {formatValue(conflict.client_value)}
          </span>
        </label>
        <label className="flex cursor-pointer flex-col gap-1 rounded-md border border-[hsl(var(--border))] bg-background p-3">
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name={groupName}
              value="server"
              checked={resolution === 'server'}
              onChange={() => onChange('server')}
              data-testid={`conflict-${conflict.field}-use-server`}
            />
            <span className="text-xs font-medium text-foreground">
              {t('useServer')}
            </span>
          </span>
          <span
            className="break-words text-sm text-foreground"
            data-testid={`conflict-${conflict.field}-server-value`}
          >
            {formatValue(conflict.server_value)}
          </span>
        </label>
      </fieldset>
    </li>
  );
}

interface PayloadPanelProps {
  label: string;
  content: string;
  testId: string;
}

function PayloadPanel({ label, content, testId }: PayloadPanelProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <pre
        data-testid={testId}
        className="max-h-48 overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2 text-xs leading-relaxed text-foreground"
      >
        {content}
      </pre>
    </div>
  );
}

export default ConflictResolutionDialog;
