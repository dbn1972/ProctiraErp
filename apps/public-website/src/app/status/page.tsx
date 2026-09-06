import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'System status',
  description:
    'Operational status of ProctiraERP public services. Subscribe for incident updates.',
  alternates: { canonical: '/status' },
};

const SERVICES = [
  { name: 'Web app', detail: 'app.proctira.org', probeKey: 'web' as const },
  { name: 'API', detail: 'api.proctira.org', probeKey: 'api' as const },
  {
    name: 'Authentication',
    detail: 'SSO, OTP & sessions',
    probeKey: 'auth' as const,
  },
  {
    name: 'SMS notifications',
    detail: 'Guardian alerts & OTP delivery',
    probeKey: null,
  },
  {
    name: 'DBT integration',
    detail: 'Disbursal & reconciliation',
    probeKey: null,
  },
  {
    name: 'Reports engine',
    detail: 'Exports, PDFs & data files',
    probeKey: null,
  },
];

type ProbeState = 'ok' | 'degraded' | 'unreachable' | 'unmonitored';

interface StatusSnapshot {
  mode: 'probed' | 'prelaunch';
  probedAt: string | null;
  probes: Partial<Record<'web' | 'api' | 'auth', ProbeState>>;
}

async function probeUrl(url: string | undefined): Promise<ProbeState> {
  if (!url) return 'unmonitored';
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (response.ok) return 'ok';
    if (response.status >= 500) return 'degraded';
    // Reachable but not healthy (auth walls, redirects, etc.)
    return 'degraded';
  } catch {
    return 'unreachable';
  }
}

async function loadStatusSnapshot(): Promise<StatusSnapshot> {
  const web = process.env.STATUS_PROBE_WEB_URL?.trim();
  const api = process.env.STATUS_PROBE_API_URL?.trim();
  const auth = process.env.STATUS_PROBE_AUTH_URL?.trim();
  const hasAnyProbe = Boolean(web || api || auth);

  if (!hasAnyProbe) {
    return { mode: 'prelaunch', probedAt: null, probes: {} };
  }

  const [webState, apiState, authState] = await Promise.all([
    probeUrl(web),
    probeUrl(api),
    probeUrl(auth),
  ]);

  return {
    mode: 'probed',
    probedAt: new Date().toISOString(),
    probes: {
      web: webState,
      api: apiState,
      auth: authState,
    },
  };
}

function serviceState(
  probeKey: 'web' | 'api' | 'auth' | null,
  snapshot: StatusSnapshot,
): ProbeState {
  if (!probeKey) return 'unmonitored';
  if (snapshot.mode === 'prelaunch') return 'unmonitored';
  return snapshot.probes[probeKey] ?? 'unmonitored';
}

function overallLabel(snapshot: StatusSnapshot): {
  title: string;
  description: string;
  tone: 'prelaunch' | 'ok' | 'attention';
} {
  if (snapshot.mode === 'prelaunch') {
    return {
      title: 'Status monitoring not instrumented',
      description:
        'This public status page is in pre-launch mode. Live uptime is not measured here until STATUS_PROBE_* URLs (or a status provider) are configured — we do not invent an all-green board.',
      tone: 'prelaunch',
    };
  }

  const values = Object.values(snapshot.probes);
  if (values.some((v) => v === 'unreachable' || v === 'degraded')) {
    return {
      title: 'Attention needed',
      description:
        'One or more probed endpoints did not return a healthy response. Operators should check runbooks and the status provider.',
      tone: 'attention',
    };
  }
  if (values.length > 0 && values.every((v) => v === 'ok')) {
    return {
      title: 'Probed endpoints responding',
      description:
        'Configured probe URLs returned healthy responses. Components without probes remain unmonitored.',
      tone: 'ok',
    };
  }
  return {
    title: 'Partial instrumentation',
    description:
      'Some services are probed; others are not yet wired. Treat unmonitored rows as unknown — not operational.',
    tone: 'prelaunch',
  };
}

/**
 * Status page — honest pre-launch or probed states only.
 * Never paints every row green unless a real probe succeeded.
 */
export default async function StatusPage() {
  const snapshot = await loadStatusSnapshot();
  const overall = overallLabel(snapshot);

  return (
    <>
      <section
        className="border-b border-border bg-gradient-to-b from-secondary/60 to-background"
        aria-labelledby="status-heading"
      >
        <div className="container py-16 text-center md:py-20">
          <span
            className={
              overall.tone === 'ok'
                ? 'inline-flex items-center gap-2.5 rounded-full border border-accent/40 bg-accent/10 px-5 py-2.5 text-base font-bold text-accent'
                : overall.tone === 'attention'
                  ? 'inline-flex items-center gap-2.5 rounded-full border border-destructive/40 bg-destructive/10 px-5 py-2.5 text-base font-bold text-destructive'
                  : 'inline-flex items-center gap-2.5 rounded-full border border-border bg-muted px-5 py-2.5 text-base font-bold text-foreground'
            }
            data-testid="status-overall"
            data-mode={snapshot.mode}
          >
            {overall.tone === 'ok' ? (
              <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
            ) : overall.tone === 'attention' ? (
              <AlertCircle aria-hidden="true" className="h-5 w-5" />
            ) : (
              <Clock aria-hidden="true" className="h-5 w-5" />
            )}
            {overall.title}
          </span>
          <h1
            id="status-heading"
            className="mt-6 text-4xl font-extrabold tracking-tight text-foreground md:text-5xl"
          >
            System status
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            {overall.description}
          </p>
          {snapshot.probedAt ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Last probe: {snapshot.probedAt}
            </p>
          ) : null}
        </div>
      </section>

      <section className="container py-16" aria-label="Component status">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Operational status of ProctiraERP components
            </caption>
            <tbody>
              {SERVICES.map((service) => {
                const state = serviceState(service.probeKey, snapshot);
                return (
                  <tr
                    key={service.name}
                    className="border-b border-border last:border-b-0"
                    data-status={state}
                  >
                    <th scope="row" className="px-6 py-5 align-top">
                      <span className="block font-semibold text-foreground">
                        {service.name}
                      </span>
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {service.detail}
                      </span>
                    </th>
                    <td className="px-6 py-5 text-right">
                      <StatusPill state={state} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="border-t border-border bg-secondary/30 py-16"
        aria-labelledby="history-heading"
      >
        <div className="container max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
            History
          </p>
          <h2
            id="history-heading"
            className="mt-3 text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            Past incidents
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Incident history appears here only after a status provider is connected.
            An empty list does not mean zero production incidents.
          </p>
          <div className="mt-8 rounded-2xl border border-border bg-card p-8 text-center">
            <Activity aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-semibold text-foreground">
              Incident feed not connected
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Wire Statuspage, Instatus, or an internal feed before publishing
              post-mortems on this surface.
            </p>
          </div>
        </div>
      </section>

      <section
        className="border-t border-border bg-primary text-primary-foreground"
        aria-labelledby="status-cta-heading"
      >
        <div className="container py-20 text-center">
          <h2
            id="status-cta-heading"
            className="text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Subscribe to status updates
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/80">
            Operations teams can receive incident notifications by email, RSS,
            or webhook once a provider is configured.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="/contact">Contact operations</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/security">How we run operations</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function StatusPill({ state }: { state: ProbeState }) {
  if (state === 'ok') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
        Responding
      </span>
    );
  }
  if (state === 'degraded') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
        Degraded
      </span>
    );
  }
  if (state === 'unreachable') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-destructive" />
        Unreachable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-muted-foreground/60" />
      Not monitored
    </span>
  );
}
