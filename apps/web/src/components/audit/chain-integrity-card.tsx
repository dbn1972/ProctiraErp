'use client';
/**
 * Audit hash-chain integrity card (PRC-M085).
 *
 * Full verification recomputes every hash, so it runs only when the user
 * presses "Verify chain" instead of on every audit-log page load. The result
 * of the latest run in this view is shown with its timestamp.
 */
import { useState, useTransition } from 'react';
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { verifyAuditChainAction } from '@/app/(dashboard)/audit-logs/actions';
import { useHydrated } from '@/hooks/useHydrated';
import type { AuditChainVerification } from '@/lib/api/platform.server';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(d);
}

type State =
  | { kind: 'idle' }
  | { kind: 'done'; verification: AuditChainVerification }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' };

export function ChainIntegrityCard() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();
  // A click on the server-rendered button before hydration is lost; keep it
  // disabled until handlers are attached.
  const hydrated = useHydrated();
  const verification = state.kind === 'done' ? state.verification : null;
  const Icon = verification ? (verification.valid ? ShieldCheck : ShieldAlert) : ShieldQuestion;

  function verify() {
    startTransition(async () => {
      try {
        const res = await verifyAuditChainAction();
        if (res.forbidden) setState({ kind: 'forbidden' });
        else if (!res.verification) setState({ kind: 'unavailable' });
        else setState({ kind: 'done', verification: res.verification });
      } catch {
        setState({ kind: 'unavailable' });
      }
    });
  }

  return (
    <Card
      data-testid="chain-integrity"
      data-valid={verification ? (verification.valid ? 'true' : 'false') : undefined}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon
            className={
              verification
                ? verification.valid
                  ? 'h-5 w-5 text-emerald-600'
                  : 'h-5 w-5 text-destructive'
                : 'h-5 w-5 text-muted-foreground'
            }
            aria-hidden="true"
          />
          Chain integrity
          {verification ? (
            <Badge variant={verification.valid ? 'success' : 'destructive'}>
              {verification.valid ? 'Verified' : 'BROKEN'}
            </Badge>
          ) : (
            <Badge variant="secondary">Not checked</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Every entry is sha256-linked to the previous one. Verification recomputes the chain from
          the first entry, so it runs on request.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={verify}
          disabled={!hydrated || pending}
          data-testid="chain-verify"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          {pending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? 'Verifying…' : verification ? 'Verify again' : 'Verify chain'}
        </Button>
        <div aria-live="polite">
          {state.kind === 'forbidden' ? (
            <p role="status" className="text-muted-foreground">
              Platform administrator access is required to verify the chain.
            </p>
          ) : null}
          {state.kind === 'unavailable' ? (
            <p role="alert" className="text-destructive">
              Verification is unavailable from the gateway. Try again.
            </p>
          ) : null}
          {verification ? (
            <>
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
                  className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
                >
                  Break at position #{verification.brokenAt.chainSeq} (entry{' '}
                  <span className="font-mono">{verification.brokenAt.entryId}</span>):{' '}
                  {verification.brokenAt.reason}. Treat every later entry as unverified and escalate
                  to the platform security owner.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
