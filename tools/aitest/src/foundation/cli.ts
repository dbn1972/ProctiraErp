/**
 * aitest CLI (pnpm --filter @proctira/aitest aitest ...):
 *
 *   stack up --unit <u> --profile none|db|core|full [--gateways 0|1|2] [--web web,admin-console]
 *            [--keycloak] [--workers etl-worker,exam-document-worker] [--node-env production]
 *            [--no-seed] [--port-base N --project P]
 *   stack down --unit <u> [--port-base N --project P]
 *   stack status --unit <u> [--port-base N --project P]
 *   run <suite-id> [--unit <u>] [--out <dir>] [--keep-stack] [--reuse-state-file <state.json>]
 *            [--port-base N --project P]
 *   suites [--cadence nightly|weekly] [--json]
 *
 * Prints AITEST_STACK_STATE=<path> and the port map; never a secret.
 */
import { resolve } from 'node:path';

import { downStack, stackStatus, upStack } from './stack/stack.js';
import {
  WEB_APPS,
  type Profile,
  type StackOptions,
  type WebApp,
  type Worker,
} from './stack/types.js';
import { discoverSuites, suitesForCadence } from './suite/discover.js';
import { runSuite } from './suite/runner.js';
import type { Cadence } from './suite/spec.js';

const out = (line: string) => process.stdout.write(`${line}\n`);

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--') continue;
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
      const next = argv[i + 1];
      if (inline !== undefined) flags.set(k, inline);
      else if (next !== undefined && !next.startsWith('--') && !BOOLEAN_FLAGS.has(k)) {
        flags.set(k, next);
        i++;
      } else flags.set(k, true);
    } else positional.push(a);
  }
  return { positional, flags };
}

const BOOLEAN_FLAGS = new Set(['keycloak', 'no-seed', 'keep-stack', 'json']);

function str(p: Parsed, k: string): string | undefined {
  const v = p.flags.get(k);
  return typeof v === 'string' ? v : undefined;
}

function num(p: Parsed, k: string): number | undefined {
  const v = str(p, k);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${k} must be an integer`);
  return n;
}

function list(p: Parsed, k: string): string[] | undefined {
  const v = str(p, k);
  return v === undefined
    ? undefined
    : v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
}

export function stackOptionsFrom(p: Parsed): StackOptions {
  const unit = str(p, 'unit');
  if (!unit) throw new Error('--unit is required');
  const profile = (str(p, 'profile') ?? 'core') as Profile;
  const web = list(p, 'web');
  for (const w of web ?? [])
    if (!WEB_APPS.includes(w as WebApp)) throw new Error(`unknown web app ${w}`);
  const gateways = num(p, 'gateways');
  if (gateways !== undefined && ![0, 1, 2].includes(gateways))
    throw new Error('--gateways must be 0, 1 or 2');
  const nodeEnv = str(p, 'node-env');
  if (nodeEnv !== undefined && nodeEnv !== 'production' && nodeEnv !== 'development') {
    throw new Error('--node-env must be development or production');
  }
  const portBase = num(p, 'port-base');
  const project = str(p, 'project');
  const workers = list(p, 'workers') as Worker[] | undefined;
  return {
    unit,
    profile,
    ...(gateways !== undefined ? { gateways: gateways as 0 | 1 | 2 } : {}),
    ...(web ? { webApps: web as WebApp[] } : {}),
    ...(p.flags.has('keycloak') ? { keycloak: true } : {}),
    ...(workers ? { workers } : {}),
    ...(nodeEnv ? { nodeEnv } : {}),
    ...(p.flags.has('no-seed') ? { seed: false } : {}),
    ...(portBase !== undefined ? { portBase } : {}),
    ...(project ? { project } : {}),
  };
}

export async function main(argv: string[]): Promise<number> {
  const p = parseArgs(argv);
  const [cmd, sub] = p.positional;
  const portBase = num(p, 'port-base');
  const project = str(p, 'project');
  const target = {
    ...(portBase !== undefined ? { portBase } : {}),
    ...(project ? { project } : {}),
  };
  if (cmd === 'stack' && sub === 'up') {
    const s = await upStack(stackOptionsFrom(p));
    out(`AITEST_STACK_STATE=${s.stateFile}`);
    out(`project=${s.project} profile=${s.profile} sha=${s.gitSha}`);
    out(`gateways=${s.urls.gateways.join(',') || '-'}`);
    for (const [app, url] of Object.entries(s.urls.web)) out(`web.${app}=${url}`);
    if (s.urls.keycloak) out(`keycloak=${s.urls.keycloak}`);
    out(`ports=${JSON.stringify(s.ports)}`);
    out(`fixtures=${s.fixturesFile}`);
    return 0;
  }
  if (cmd === 'stack' && sub === 'down') {
    const unit = str(p, 'unit');
    if (!unit) throw new Error('--unit is required');
    await downStack(unit, target);
    out(
      `stack ${project ?? `proctira-aitest-${unit}`} removed (containers, volumes, processes, state)`,
    );
    return 0;
  }
  if (cmd === 'stack' && sub === 'status') {
    const unit = str(p, 'unit');
    if (!unit) throw new Error('--unit is required');
    const st = await stackStatus(unit, target);
    out(st.state ? `AITEST_STACK_STATE=${st.state.stateFile}` : 'no state file');
    for (const c of st.containers) out(`${c.name}\t${c.status}`);
    for (const [svc, rec] of Object.entries(st.state?.services ?? {}))
      out(`${svc}\tpid ${rec.pid}\tport ${rec.port}`);
    return 0;
  }
  if (cmd === 'run' && sub) {
    const outDir = str(p, 'out');
    const reuse = str(p, 'reuse-state-file');
    const unit = str(p, 'unit');
    return runSuite(sub, {
      ...target,
      ...(outDir ? { out: resolve(outDir) } : {}),
      ...(reuse ? { reuseStateFile: resolve(reuse) } : {}),
      ...(unit ? { unit } : {}),
      ...(p.flags.has('keep-stack') ? { keepStack: true } : {}),
    });
  }
  if (cmd === 'suites') {
    const cadence = str(p, 'cadence') as Cadence | undefined;
    const all = discoverSuites();
    const suites = cadence ? suitesForCadence(all, cadence) : all;
    if (p.flags.has('json')) out(JSON.stringify(suites.map((s) => s.id)));
    else
      for (const s of suites)
        out(
          `${s.id}\t${Array.isArray(s.cadence) ? s.cadence.join('+') : s.cadence}\t${s.profile}\t${s.title}`,
        );
    return 0;
  }
  process.stderr.write(
    'usage: aitest stack up|down|status --unit <u> ... | aitest run <suite> ... | aitest suites [--cadence c] [--json]\n',
  );
  return 2;
}

const invokedDirectly = process.argv[1] !== undefined && /cli\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`[aitest] ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
